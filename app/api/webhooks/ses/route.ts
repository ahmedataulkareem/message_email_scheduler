import { NextResponse, type NextRequest } from "next/server";
import SnsValidator from "sns-validator";
import { supabaseAdmin } from "@/lib/supabase";

const validator = new SnsValidator();

function validateSns(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validator.validate(message as any, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let sns: Record<string, unknown>;
  try {
    sns = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    await validateSns(sns);
  } catch {
    return NextResponse.json({ error: "invalid SNS signature" }, { status: 403 });
  }

  if (sns.Type === "SubscriptionConfirmation") {
    await fetch(sns.SubscribeURL as string);
    return NextResponse.json({ ok: true, confirmed: true });
  }
  if (sns.Type !== "Notification") return NextResponse.json({ ok: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = JSON.parse(sns.Message as string) as any;
  const messageId: string | undefined = event.mail?.messageId;
  if (!messageId) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const eventType: string = event.eventType || event.notificationType;

  if (eventType === "Delivery") {
    await db.from("messages").update({ status: "delivered", updated_at: new Date().toISOString() }).eq("provider_id", messageId);
  } else if (eventType === "Bounce") {
    await db
      .from("messages")
      .update({ status: "bounced", error: event.bounce?.bounceType, updated_at: new Date().toISOString() })
      .eq("provider_id", messageId);
    if (event.bounce?.bounceType === "Permanent") {
      const { data: msg } = await db.from("messages").select("tenant_id, to_addr").eq("provider_id", messageId).maybeSingle();
      if (msg) {
        await db.from("suppressions").upsert({ tenant_id: msg.tenant_id, channel: "email", value: msg.to_addr, reason: "hard bounce" });
      }
    }
  } else if (eventType === "Complaint") {
    await db.from("messages").update({ status: "complained", updated_at: new Date().toISOString() }).eq("provider_id", messageId);
    const { data: msg } = await db.from("messages").select("tenant_id, to_addr").eq("provider_id", messageId).maybeSingle();
    if (msg) {
      await db.from("suppressions").upsert({ tenant_id: msg.tenant_id, channel: "email", value: msg.to_addr, reason: "spam complaint" });
    }
  }

  return NextResponse.json({ ok: true });
}
