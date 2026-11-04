"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeCell, normalizeEmail } from "@/lib/contacts-import";

/** Public opt-in form. No auth — this is how people consent to get texts. */
export async function joinSms(formData: FormData) {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) redirect("/join?error=Not configured yet");

  const firstName = String(formData.get("first_name") || "").trim();
  const lastName = String(formData.get("last_name") || "").trim();
  const cell = normalizeCell(formData.get("phone"));
  const email = normalizeEmail(formData.get("email"));
  const consent = formData.get("consent") === "on";

  if (!firstName || !cell) redirect("/join?error=Name and a valid cell phone are required");
  if (!consent) redirect("/join?error=Please check the consent box to continue");

  const db = supabaseAdmin();
  const { error } = await db.from("contacts").upsert(
    {
      tenant_id: tenantId,
      first_name: firstName,
      last_name: lastName || null,
      cell_e164: cell,
      email,
      sms_consent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,cell_e164" }
  );

  if (error) redirect(`/join?error=${encodeURIComponent(error.message)}`);
  redirect("/join?joined=1");
}
