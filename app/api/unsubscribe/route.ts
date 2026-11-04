import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubToken } from "@/lib/send";
import { supabaseAdmin } from "@/lib/supabase";

async function unsubscribe(token: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "missing token" };
  const parsed = verifyUnsubToken(token);
  if (!parsed) return { ok: false, error: "invalid token" };

  const db = supabaseAdmin();
  const { data: contact } = await db
    .from("contacts")
    .select("tenant_id, email, cell_e164")
    .eq("id", parsed.contactId)
    .maybeSingle();
  if (!contact) return { ok: false, error: "unknown contact" };

  const value = parsed.channel === "email" ? contact.email : contact.cell_e164;
  if (!value) return { ok: false, error: "no address on file" };

  await db.from("suppressions").upsert({ tenant_id: contact.tenant_id, channel: parsed.channel, value, reason: "unsubscribe link" });
  return { ok: true };
}

// One-click unsubscribe (RFC 8058): mail clients POST here with no user interaction.
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const result = await unsubscribe(token);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

// A person clicking the link in their mail client gets a plain confirmation page.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const result = await unsubscribe(token);
  const message = result.ok ? "You're unsubscribed. You won't get any more messages." : `Couldn't process that: ${result.error}`;
  return new NextResponse(
    `<!doctype html><html><body style="font-family:system-ui;max-width:480px;margin:80px auto"><p>${message}</p></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
