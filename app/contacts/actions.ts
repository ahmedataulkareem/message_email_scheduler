"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireMembership } from "@/lib/auth";
import { mapHeaders, missingRequiredFields, hasContactChannel, normalizeRow, type ContactRecord } from "@/lib/contacts-import";

export interface UploadResult {
  ok: boolean;
  error?: string;
  unmatchedHeaders?: string[];
  rowsRead?: number;
  imported?: number;
  skipped?: number;
}

/**
 * Uploads any .xlsx/.xls/.csv file whose columns look like a voter/contact
 * file (matched by lib/contacts-import.ts's alias table, not an exact
 * column-for-column match to District 23). Rows are upserted so re-uploading
 * the same file — or an updated version of it — doesn't create duplicates.
 */
export async function uploadContacts(formData: FormData): Promise<UploadResult> {
  const { tenantId } = await requireMembership();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file selected." };
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    return { ok: false, error: "Upload an .xlsx, .xls or .csv file." };
  }

  let rows: Record<string, unknown>[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  } catch {
    return { ok: false, error: "Couldn't read that file. Is it a valid spreadsheet?" };
  }
  if (rows.length === 0) return { ok: false, error: "That sheet has no rows." };

  const headers = Object.keys(rows[0]);
  const mapping = mapHeaders(headers);
  const missing = missingRequiredFields(mapping);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Couldn't find a column for: ${missing.join(", ")}.`,
      unmatchedHeaders: headers.filter((h) => !mapping[h]),
    };
  }
  if (!hasContactChannel(mapping)) {
    return { ok: false, error: "No email or cell phone column found — nothing to message." };
  }

  const byVoterId: ContactRecord[] = [];
  const byEmail: ContactRecord[] = [];
  const byCell: ContactRecord[] = [];
  let skipped = 0;

  for (const row of rows) {
    const rec = normalizeRow(row, mapping);
    if (!rec) {
      skipped++;
      continue;
    }
    if (rec.voter_id) byVoterId.push(rec);
    else if (rec.email) byEmail.push(rec);
    else byCell.push(rec);
  }

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const withTenant = (recs: ContactRecord[]) => recs.map((r) => ({ ...r, tenant_id: tenantId, updated_at: now }));

  let imported = 0;
  for (const [batch, onConflict] of [
    [byVoterId, "tenant_id,voter_id"],
    [byEmail, "tenant_id,email"],
    [byCell, "tenant_id,cell_e164"],
  ] as const) {
    if (batch.length === 0) continue;
    const { error, count } = await db
      .from("contacts")
      .upsert(withTenant(batch), { onConflict, count: "exact" });
    if (error) return { ok: false, error: `Database error: ${error.message}` };
    imported += count ?? batch.length;
  }

  await db.from("audit_log").insert({ tenant_id: tenantId, action: "contacts.upload", target: file.name });

  revalidatePath("/contacts");
  return { ok: true, rowsRead: rows.length, imported, skipped };
}

export async function searchContacts(query: string) {
  const { tenantId } = await requireMembership();
  if (!query.trim()) return [];
  const db = supabaseAdmin();
  const { data } = await db
    .from("contacts")
    .select("id, first_name, last_name, email, cell_e164, party, zip")
    .eq("tenant_id", tenantId)
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,cell_e164.ilike.%${query}%`)
    .limit(25);
  return data ?? [];
}
