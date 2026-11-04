import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  render,
  fillName,
  inQuietHours,
  nextSendableTime,
  blockedByAllowlist,
  sendEmailProvider,
  sendSmsProvider,
  nextRetry,
  unsubToken,
  type Tenant,
} from "@/lib/send";

// Runs every minute (vercel.json). Claims queued messages and sends them.
// ~300/min caps a 48k-email blast at roughly 3 hours; raise BATCH_SIZE or add
// a second cron path if a campaign needs to go out faster than that.
const BATCH_SIZE = 300;
const CONCURRENCY = 20;

function authorized(req: NextRequest): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

interface MessageRow {
  id: string;
  tenant_id: string;
  contact_id: string;
  channel: "email" | "sms";
  to_addr: string;
  subject: string | null;
  body: string;
  attempts: number;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: claimed, error } = await db.rpc("claim_messages", { p_limit: BATCH_SIZE });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const messages = (claimed ?? []) as MessageRow[];
  if (messages.length === 0) return NextResponse.json({ ok: true, sent: 0, failed: 0 });

  const tenantIds = [...new Set(messages.map((m) => m.tenant_id))];
  const contactIds = [...new Set(messages.map((m) => m.contact_id))];

  const [{ data: tenants }, { data: contacts }] = await Promise.all([
    db.from("tenants").select("*").in("id", tenantIds),
    db.from("contacts").select("id, first_name, email, cell_e164").in("id", contactIds),
  ]);

  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t as Tenant]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));

  let sent = 0;
  let failed = 0;
  let deferred = 0;

  async function processOne(msg: MessageRow) {
    const tenant = tenantById.get(msg.tenant_id);
    const contact = contactById.get(msg.contact_id);
    if (!tenant || !contact) {
      await db.from("messages").update({ status: "failed", error: "missing tenant or contact" }).eq("id", msg.id);
      failed++;
      return;
    }

    if (msg.channel === "sms" && inQuietHours(new Date(), tenant.timezone)) {
      const next = nextSendableTime(new Date(), tenant.timezone);
      await db.from("messages").update({ status: "queued", next_attempt_at: next.toISOString() }).eq("id", msg.id);
      deferred++;
      return;
    }

    if (blockedByAllowlist(msg.to_addr)) {
      await db.from("messages").update({ status: "failed", error: "blocked by allowlist" }).eq("id", msg.id);
      failed++;
      return;
    }

    try {
      const body = render(msg.body, contact, tenant, msg.channel);
      if (msg.channel === "email") {
        const subject = msg.subject ? fillName(msg.subject, contact) : "Message from your representative";
        const unsubscribeUrl = `${process.env.APP_URL}/api/unsubscribe?t=${unsubToken(msg.contact_id, "email")}`;
        const { providerId } = await sendEmailProvider({
          to: msg.to_addr,
          from: tenant.from_email,
          fromName: tenant.from_name,
          subject,
          text: body,
          unsubscribeUrl,
        });
        await db
          .from("messages")
          .update({ status: "sent", provider_id: providerId, sent_at: new Date().toISOString() })
          .eq("id", msg.id);
      } else {
        const { providerId } = await sendSmsProvider({ to: msg.to_addr, body });
        await db
          .from("messages")
          .update({ status: "sent", provider_id: providerId, sent_at: new Date().toISOString() })
          .eq("id", msg.id);
      }
      sent++;
    } catch (err) {
      const { nextAttemptAt, failed: giveUp } = nextRetry(msg.attempts + 1);
      await db
        .from("messages")
        .update({
          status: giveUp ? "failed" : "queued",
          attempts: msg.attempts + 1,
          next_attempt_at: nextAttemptAt.toISOString(),
          error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", msg.id);
      failed++;
    }
  }

  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const batch = messages.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processOne));
  }

  return NextResponse.json({ ok: true, claimed: messages.length, sent, failed, deferred });
}
