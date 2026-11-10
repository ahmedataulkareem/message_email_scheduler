// The scheduler's three jobs. Vercel cron calls them through /api/cron/*,
// and the Dashboard's "Run now" buttons call them directly, so the same code
// runs locally (no cron there) and in production.
import { supabaseAdmin } from "./supabase";
import {
  render,
  fillName,
  inQuietHours,
  nextSendableTime,
  blockedByAllowlist,
  sendEmailProvider,
  sendSmsProvider,
  nextRetry,
  isPermanentError,
  unsubToken,
  type Tenant,
} from "./send";

export interface EnqueueResult {
  queued: number;
  errors: string[];
}

/** Queues today's birthday greetings (email + SMS) for every tenant. */
export async function enqueueBirthdays(): Promise<EnqueueResult> {
  const db = supabaseAdmin();
  const result: EnqueueResult = { queued: 0, errors: [] };
  const { data: tenants, error } = await db.from("tenants").select("id, name");
  if (error) return { queued: 0, errors: [error.message] };

  for (const t of tenants ?? []) {
    const { data, error: e } = await db.rpc("enqueue_birthdays", { p_tenant_id: t.id });
    if (e) result.errors.push(`${t.name}: ${e.message}`);
    else result.queued += data as number;
  }
  return result;
}

/** Queues every approved campaign whose send time has arrived. */
export async function enqueueDueCampaigns(): Promise<EnqueueResult & { campaigns: number }> {
  const db = supabaseAdmin();
  const result = { queued: 0, campaigns: 0, errors: [] as string[] };
  const { data: due, error } = await db
    .from("campaigns")
    .select("id")
    .eq("status", "approved")
    .lte("send_at", new Date().toISOString());
  if (error) return { ...result, errors: [error.message] };

  for (const c of due ?? []) {
    const { data, error: e } = await db.rpc("enqueue_campaign", { p_campaign_id: c.id });
    if (e) result.errors.push(`campaign ${c.id}: ${e.message}`);
    else {
      result.campaigns++;
      result.queued += data as number;
    }
  }
  return result;
}

export interface SendResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  errors: string[];
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

const CONCURRENCY = 20;

/** Sends up to `limit` queued messages. ~300/min caps a 48k blast at ~3h. */
export async function sendQueued(limit = 300): Promise<SendResult> {
  const db = supabaseAdmin();
  const result: SendResult = { claimed: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, errors: [] };

  const { data: claimed, error } = await db.rpc("claim_messages", { p_limit: limit });
  if (error) return { ...result, errors: [error.message] };
  const messages = (claimed ?? []) as MessageRow[];
  result.claimed = messages.length;
  if (messages.length === 0) return result;

  const tenantIds = [...new Set(messages.map((m) => m.tenant_id))];
  const contactIds = [...new Set(messages.map((m) => m.contact_id))];
  const [{ data: tenants }, { data: contacts }] = await Promise.all([
    db.from("tenants").select("*").in("id", tenantIds),
    db.from("contacts").select("id, first_name").in("id", contactIds),
  ]);
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t as Tenant]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));

  const update = (id: string, fields: Record<string, unknown>) =>
    db.from("messages").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);

  async function processOne(msg: MessageRow) {
    const tenant = tenantById.get(msg.tenant_id);
    const contact = contactById.get(msg.contact_id);
    if (!tenant || !contact) {
      await update(msg.id, { status: "failed", error: "contact or tenant no longer exists" });
      result.failed++;
      return;
    }

    if (msg.channel === "sms" && inQuietHours(new Date(), tenant.timezone)) {
      await update(msg.id, { status: "queued", next_attempt_at: nextSendableTime(new Date(), tenant.timezone).toISOString() });
      result.deferred++;
      return;
    }

    if (blockedByAllowlist(msg.to_addr)) {
      await update(msg.id, { status: "skipped", error: "Not on SEND_ALLOWLIST (test mode)" });
      result.skipped++;
      return;
    }

    try {
      const body = render(msg.body, contact, tenant, msg.channel);
      const { providerId } =
        msg.channel === "email"
          ? await sendEmailProvider({
              to: msg.to_addr,
              from: tenant.from_email,
              fromName: tenant.from_name,
              subject: msg.subject ? fillName(msg.subject, contact) : `A message from ${tenant.from_name || "us"}`,
              text: body,
              unsubscribeUrl: `${process.env.APP_URL}/api/unsubscribe?t=${unsubToken(msg.contact_id, "email")}`,
            })
          : await sendSmsProvider({ to: msg.to_addr, body });
      await update(msg.id, { status: "sent", provider_id: providerId, sent_at: new Date().toISOString(), error: null });
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = msg.attempts + 1;
      const { nextAttemptAt, failed } = nextRetry(attempts);
      const giveUp = failed || isPermanentError(err);
      await update(msg.id, {
        status: giveUp ? "failed" : "queued",
        attempts,
        next_attempt_at: nextAttemptAt.toISOString(),
        error: message,
      });
      if (giveUp) result.failed++;
      if (!result.errors.includes(message)) result.errors.push(message);
    }
  }

  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    await Promise.all(messages.slice(i, i + CONCURRENCY).map(processOne));
  }
  return result;
}
