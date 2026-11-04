import { NextResponse, type NextRequest } from "next/server";
import twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase";

const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  sent: "sent",
  delivered: "delivered",
  undelivered: "undelivered",
  failed: "failed",
};

export async function POST(req: NextRequest) {
  const bodyText = await req.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));
  const signature = req.headers.get("x-twilio-signature") || "";
  const url = `${process.env.APP_URL}/api/webhooks/twilio`;

  const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, url, params);
  if (!valid) return NextResponse.json({ error: "invalid signature" }, { status: 403 });

  const db = supabaseAdmin();
  const tenantId = process.env.DEFAULT_TENANT_ID!;

  // Inbound keyword (STOP/START/HELP) has a Body and no MessageStatus;
  // a delivery status callback for an outbound message has MessageStatus instead.
  if (params.Body !== undefined && params.From && !params.MessageStatus) {
    const from = params.From;
    const keyword = params.Body.trim().toUpperCase();
    if (keyword === "STOP" || keyword === "STOPALL" || keyword === "UNSUBSCRIBE") {
      await db.from("suppressions").upsert({ tenant_id: tenantId, channel: "sms", value: from, reason: "STOP reply" });
    } else if (keyword === "START" || keyword === "UNSTOP") {
      await db.from("suppressions").delete().eq("tenant_id", tenantId).eq("channel", "sms").eq("value", from);
    }
    return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
  }

  if (params.MessageSid && params.MessageStatus) {
    const status = STATUS_MAP[params.MessageStatus] ?? params.MessageStatus;
    await db
      .from("messages")
      .update({ status, error: params.ErrorMessage || null, updated_at: new Date().toISOString() })
      .eq("provider_id", params.MessageSid);
  }

  return NextResponse.json({ ok: true });
}
