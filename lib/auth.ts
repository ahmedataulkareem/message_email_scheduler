import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "./supabase";

export async function getSession() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}, // reads only here; middleware.ts handles refresh/writes
      },
    }
  );
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export type Role = "admin" | "approver" | "staff";

/**
 * Pilot is single-tenant: tenant comes from DEFAULT_TENANT_ID. The first time
 * a signed-in user has no membership row, one is created with role 'staff'.
 * ponytail: fine for one pilot customer; before onboarding a second tenant,
 * replace this with a real invite flow and per-tenant membership lookup.
 */
export async function requireMembership(): Promise<{ userId: string; tenantId: string; role: Role }> {
  const user = await getSession();
  if (!user) redirect("/login");

  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID not set");

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) return { userId: user.id, tenantId, role: existing.role as Role };

  await db.from("memberships").insert({ user_id: user.id, tenant_id: tenantId, role: "staff" });
  return { userId: user.id, tenantId, role: "staff" };
}

export async function requireApprover() {
  const m = await requireMembership();
  if (m.role !== "admin" && m.role !== "approver") redirect("/campaigns?error=forbidden");
  return m;
}

export async function requireAdmin() {
  const m = await requireMembership();
  if (m.role !== "admin") redirect("/dashboard?error=forbidden");
  return m;
}
