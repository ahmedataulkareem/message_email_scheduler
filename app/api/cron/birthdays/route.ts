import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Runs once a day (vercel.json: 14:00 UTC, ~10am America/New_York — drifts an
// hour with DST; fine for a daily birthday send, tighten if that matters).
// 1. Enqueues today's birthday greetings for every tenant.
// 2. Enqueues any approved campaign whose send_at has passed.

function authorized(req: NextRequest): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const results: Record<string, number> = {};

  const { data: tenants, error: tErr } = await db.from("tenants").select("id");
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  for (const tenant of tenants ?? []) {
    const { data, error } = await db.rpc("enqueue_birthdays", { p_tenant_id: tenant.id });
    results[`birthdays:${tenant.id}`] = error ? -1 : (data as number);
  }

  const { data: due } = await db
    .from("campaigns")
    .select("id")
    .eq("status", "approved")
    .lte("send_at", new Date().toISOString());

  for (const campaign of due ?? []) {
    const { data, error } = await db.rpc("enqueue_campaign", { p_campaign_id: campaign.id });
    results[`campaign:${campaign.id}`] = error ? -1 : (data as number);
  }

  return NextResponse.json({ ok: true, results });
}
