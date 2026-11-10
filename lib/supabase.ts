import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

/**
 * Service-role client for server-only code (cron jobs, webhooks, server
 * actions). Never import this from client components — the key bypasses RLS.
 *
 * ponytail: we never use Supabase Realtime, but supabase-js still builds a
 * RealtimeClient on construction, which needs a global WebSocket — missing
 * on Node < 22 (Vercel's and this machine's runtime). `ws` supplies it.
 */
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false }, realtime: { transport: WebSocket as never } });
}
