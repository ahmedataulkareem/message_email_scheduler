import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-only code (cron jobs, webhooks, server
 * actions). Never import this from client components — the key bypasses RLS.
 */
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}
