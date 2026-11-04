"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireMembership } from "@/lib/auth";

export async function addSuppression(formData: FormData) {
  const { tenantId } = await requireMembership();
  const channel = String(formData.get("channel"));
  const value = String(formData.get("value") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || "manual";
  if (!value) redirect("/suppressions?error=Value is required");

  const db = supabaseAdmin();
  await db.from("suppressions").upsert({ tenant_id: tenantId, channel, value, reason });
  revalidatePath("/suppressions");
  redirect("/suppressions");
}

/** One "channel,value,reason" pair per line, e.g. "email,pat@example.com,requested". */
export async function bulkAddSuppressions(formData: FormData) {
  const { tenantId } = await requireMembership();
  const text = String(formData.get("lines") || "");
  const db = supabaseAdmin();

  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [channel, value, ...rest] = line.split(",").map((s) => s.trim());
      return { tenant_id: tenantId, channel, value, reason: rest.join(",") || "bulk upload" };
    })
    .filter((r) => (r.channel === "email" || r.channel === "sms") && r.value);

  if (rows.length > 0) await db.from("suppressions").upsert(rows);
  revalidatePath("/suppressions");
  redirect("/suppressions");
}

export async function removeSuppression(formData: FormData) {
  const { tenantId } = await requireMembership();
  const channel = String(formData.get("channel"));
  const value = String(formData.get("value"));
  const db = supabaseAdmin();
  await db.from("suppressions").delete().eq("tenant_id", tenantId).eq("channel", channel).eq("value", value);
  revalidatePath("/suppressions");
}
