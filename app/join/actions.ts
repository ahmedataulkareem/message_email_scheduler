"use server";

import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeCell, normalizeEmail, externalKey } from "@/lib/contacts-import";

/** Public opt-in form. No auth — this is how people consent to get texts. */
export async function joinSms(formData: FormData) {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) redirect("/join?error=Not configured yet");

  const firstName = String(formData.get("first_name") || "").trim();
  const lastName = String(formData.get("last_name") || "").trim() || null;
  const cell = normalizeCell(formData.get("phone"));
  const email = normalizeEmail(formData.get("email"));
  const consent = formData.get("consent") === "on";

  if (!firstName || !cell) redirect("/join?error=Name and a valid US cell phone are required");
  if (!consent) redirect("/join?error=Please check the consent box to continue");

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  // Opting in again overrides an earlier STOP for this number.
  await db.from("suppressions").delete().eq("tenant_id", tenantId).eq("channel", "sms").eq("value", cell);

  // Already on file (e.g. from the voter list) with this phone and first
  // name? Record consent on that person rather than creating a duplicate.
  const { data: matched, error: matchError } = await db
    .from("contacts")
    .update({ sms_consent_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("cell_e164", cell)
    .ilike("first_name", firstName.replace(/[%_]/g, ""))
    .select("id");
  if (matchError) redirect(`/join?error=${encodeURIComponent(matchError.message)}`);

  if (!matched?.length) {
    const { error } = await db.from("contacts").upsert(
      {
        tenant_id: tenantId,
        external_key: externalKey({ voter_id: null, email: null, cell_e164: cell, first_name: firstName, last_name: lastName }),
        first_name: firstName,
        last_name: lastName,
        cell_e164: cell,
        email,
        sms_consent_at: now,
        updated_at: now,
      },
      { onConflict: "tenant_id,external_key" }
    );
    if (error) redirect(`/join?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/join?joined=1");
}
