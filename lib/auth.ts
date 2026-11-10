import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import WebSocket from "ws";
import { supabaseAdmin } from "./supabase";

/**
 * Supabase client bound to the signed-in user's cookies. Server actions and
 * route handlers can write cookies (sign-in, code exchange) — that write is
 * what keeps the session. Server components can't, so the write is skipped
 * there and middleware.ts refreshes the session instead.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component: cookies are read-only there.
        }
      },
    },
    // supabase-js needs a WebSocket class just to construct; Node < 22 has none.
    realtime: { transport: WebSocket as never },
  });
}

export async function getSession() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export type Role = "admin" | "approver" | "staff";

/**
 * Pilot is single-tenant: tenant comes from DEFAULT_TENANT_ID. A signed-in
 * user with no membership gets one; while the tenant has no admin, that
 * user becomes admin (so whoever sets the system up can reach Settings and
 * approve campaigns), everyone after that starts as staff.
 * ponytail: fine for one pilot customer; replace with an invite flow before
 * a second tenant.
 */
export async function requireMembership(): Promise<{ userId: string; tenantId: string; role: Role }> {
  const user = await getSession();
  if (!user) redirect("/login");

  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID not set");

  const db = supabaseAdmin();
  const [{ data: existing }, { count: admins }] = await Promise.all([
    db.from("memberships").select("role").eq("user_id", user.id).eq("tenant_id", tenantId).maybeSingle(),
    db.from("memberships").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("role", "admin"),
  ]);

  const role: Role = admins === 0 ? "admin" : ((existing?.role as Role) ?? "staff");
  if (!existing) {
    await db.from("memberships").insert({ user_id: user.id, tenant_id: tenantId, role });
  } else if (existing.role !== role) {
    await db.from("memberships").update({ role }).eq("user_id", user.id).eq("tenant_id", tenantId);
  }
  return { userId: user.id, tenantId, role };
}

export async function requireApprover() {
  const m = await requireMembership();
  if (m.role !== "admin" && m.role !== "approver") redirect("/dashboard?error=Only an approver or admin can do that.");
  return m;
}

export async function requireAdmin() {
  const m = await requireMembership();
  if (m.role !== "admin") redirect("/dashboard?error=Only an admin can open Settings.");
  return m;
}
