"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

export async function saveSettings(formData: FormData) {
  const { tenantId } = await requireAdmin();
  const db = supabaseAdmin();

  const fields = [
    "name",
    "timezone",
    "from_email",
    "from_name",
    "email_footer",
    "sms_footer",
    "birthday_email_subject",
    "birthday_email_body",
    "birthday_sms_body",
  ];
  const update: Record<string, string> = {};
  for (const f of fields) update[f] = String(formData.get(f) || "").trim();

  const { error } = await db.from("tenants").update(update).eq("id", tenantId);
  if (error) redirect(`/settings?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
