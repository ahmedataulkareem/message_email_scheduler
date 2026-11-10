"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireMembership } from "@/lib/auth";
import { parseWorkbook, importRows, type ImportResult } from "@/lib/contacts-import";

/**
 * Uploads any .xlsx/.xls/.csv whose columns look like a voter/contact file
 * (matched by name, see lib/contacts-import.ts). Re-uploading the same or an
 * updated file updates people instead of duplicating them.
 */
export async function uploadContacts(formData: FormData): Promise<ImportResult> {
  const { tenantId, userId } = await requireMembership();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file selected." };
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return { ok: false, error: "Upload an .xlsx, .xls or .csv file." };

  let rows: Record<string, unknown>[];
  try {
    rows = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { ok: false, error: "Couldn't read that file. Is it a valid spreadsheet?" };
  }

  const db = supabaseAdmin();
  const result = await importRows(db, tenantId, rows);
  await db.from("audit_log").insert({
    tenant_id: tenantId,
    actor: userId,
    action: result.ok ? "contacts.upload" : "contacts.upload_failed",
    target: file.name,
  });

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return result;
}

export async function searchContacts(query: string) {
  const { tenantId } = await requireMembership();
  // Characters that carry meaning in a PostgREST filter string.
  const q = query.replace(/[,()%*\\"]/g, " ").trim();
  if (!q) return [];
  const db = supabaseAdmin();
  const { data } = await db
    .from("contacts")
    .select("id, first_name, last_name, email, cell_e164, party, zip, birthdate, sms_consent_at")
    .eq("tenant_id", tenantId)
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,cell_e164.ilike.%${q}%`)
    .limit(25);
  return data ?? [];
}
