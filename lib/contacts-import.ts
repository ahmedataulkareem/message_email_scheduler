// Importing a voter/contact spreadsheet: column matching by name (so any file
// "similar" to District 23 works, not just its exact layout), row
// normalization, and the upsert. Used by both the /contacts upload and
// scripts/import-contacts.ts, so there is one import path.
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CanonicalField {
  key: string;
  required?: boolean;
  aliases: string[];
}

// Aliases are drawn from Column_Description.xlsx and the District 23 sample
// headers, plus plain-English variants. Matching is case/space/underscore
// insensitive (see normalizeHeader).
export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: "voter_id", aliases: ["Voters_StateVoterID", "StateVoterID", "VoterID", "Voter ID"] },
  { key: "first_name", required: true, aliases: ["Voters_FirstName", "FirstName", "First Name"] },
  { key: "last_name", required: true, aliases: ["Voters_LastName", "LastName", "Last Name"] },
  { key: "email", aliases: ["email1", "email", "Email", "Email1", "EmailAddress", "Email Address"] },
  { key: "email_status", aliases: ["Status", "Email Status", "EmailStatus"] },
  {
    key: "cell",
    aliases: ["VoterTelephones_CellPhoneUnformatted", "CellPhone", "Cell Phone", "Mobile", "Mobile Phone", "Cell"],
  },
  { key: "birthdate", aliases: ["Voters_BirthDate", "BirthDate", "DOB", "Date of Birth"] },
  { key: "gender", aliases: ["Voters_Gender", "Gender"] },
  { key: "age", aliases: ["Voters_Age", "Age"] },
  { key: "party", aliases: ["Parties_Description", "Party"] },
  { key: "zip", aliases: ["Residence_Addresses_Zip", "Zip", "ZipCode", "Zip Code", "Postal Code"] },
  { key: "city", aliases: ["Residence_Addresses_City", "City"] },
  { key: "state", aliases: ["Residence_Addresses_State", "State"] },
  { key: "county", aliases: ["County"] },
];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** Maps each uploaded header to a canonical field key, or null if unrecognized. */
export function mapHeaders(headers: string[]): Record<string, string | null> {
  const byNormalized = new Map<string, string>();
  for (const field of CANONICAL_FIELDS) {
    for (const alias of field.aliases) byNormalized.set(normalizeHeader(alias), field.key);
  }
  const mapping: Record<string, string | null> = {};
  for (const h of headers) mapping[h] = byNormalized.get(normalizeHeader(h)) ?? null;
  return mapping;
}

export function missingRequiredFields(mapping: Record<string, string | null>): string[] {
  const mapped = new Set(Object.values(mapping));
  return CANONICAL_FIELDS.filter((f) => f.required && !mapped.has(f.key)).map((f) => f.key);
}

export function hasContactChannel(mapping: Record<string, string | null>): boolean {
  const mapped = new Set(Object.values(mapping));
  return mapped.has("email") || mapped.has("cell");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

/**
 * To E.164. Bare numbers are read as US (10 digits, or 11 starting with 1);
 * a number typed with a leading "+" keeps its own country code.
 */
export function normalizeCell(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function normalizeBirthdate(raw: unknown): string | null {
  // Excel stores dates as a day count from 1899-12-30. Converting the serial
  // directly in UTC avoids the timezone shift that turned 4 March into
  // 3 March when the file was read on a machine east of UTC (e.g. IST).
  if (typeof raw === "number" && raw > 0 && raw < 2958465) {
    const iso = new Date(Math.round((raw - 25569) * 86_400_000)).toISOString().slice(0, 10);
    return iso.startsWith("9999") ? null : iso;
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s.includes("9999")) return null; // year-only placeholder dates
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const [, mo, d, y] = mdy;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  return null;
}

export type EmailStatus = "deliverable" | "undeliverable" | "catch_all" | "unverified";

export function normalizeEmailStatus(raw: unknown): EmailStatus {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "deliverable") return "deliverable";
  if (v === "undeliverable" || v === "invalid") return "undeliverable";
  if (v === "catch all" || v === "catch_all" || v === "catchall") return "catch_all";
  return "unverified";
}

export interface ContactRecord {
  external_key: string;
  voter_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_status: EmailStatus;
  cell_e164: string | null;
  birthdate: string | null;
  gender: string | null;
  age: number | null;
  party: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  raw: Record<string, unknown>;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * One stable identity per person, so re-uploading a file updates rows
 * instead of duplicating them. Voter id when the file has one; else email;
 * else phone + name (phones alone aren't unique: households share them).
 * Must match the backfill in supabase/migrations/0002_fixes.sql.
 */
export function externalKey(c: {
  voter_id: string | null;
  email: string | null;
  cell_e164: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  if (c.voter_id) return `voter:${c.voter_id}`;
  if (c.email) return `email:${c.email}`;
  return `cell:${c.cell_e164 ?? ""}:${(c.first_name ?? "").toLowerCase()}:${(c.last_name ?? "").toLowerCase()}`;
}

/**
 * Turns one uploaded row into a contact record ready to upsert, or null if
 * the row has neither an email nor a usable cell number — nothing to message.
 */
export function normalizeRow(row: Record<string, unknown>, mapping: Record<string, string | null>): ContactRecord | null {
  const byKey = new Map<string, unknown>();
  for (const [header, key] of Object.entries(mapping)) {
    if (key) byKey.set(key, row[header]);
  }

  const email = normalizeEmail(byKey.get("email"));
  const cell = normalizeCell(byKey.get("cell"));
  if (!email && !cell) return null;

  const ageRaw = byKey.get("age");
  const age = typeof ageRaw === "number" ? ageRaw : parseInt(String(ageRaw ?? ""), 10);
  const voterId = str(byKey.get("voter_id"));
  const firstName = str(byKey.get("first_name"));
  const lastName = str(byKey.get("last_name"));

  return {
    external_key: externalKey({ voter_id: voterId, email, cell_e164: cell, first_name: firstName, last_name: lastName }),
    voter_id: voterId,
    first_name: firstName,
    last_name: lastName,
    email,
    email_status: email ? normalizeEmailStatus(byKey.get("email_status")) : "unverified",
    cell_e164: cell,
    birthdate: normalizeBirthdate(byKey.get("birthdate")),
    gender: str(byKey.get("gender")),
    age: Number.isFinite(age) ? age : null,
    party: str(byKey.get("party")),
    zip: str(byKey.get("zip")),
    city: str(byKey.get("city")),
    state: str(byKey.get("state")),
    county: str(byKey.get("county")),
    raw: row,
  };
}

/** First sheet as row objects keyed by header. Dates stay Excel serials (see normalizeBirthdate). */
export function parseWorkbook(buf: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  unmatchedHeaders?: string[];
  rowsRead?: number;
  imported?: number;
  skipped?: number;
  duplicatesInFile?: number;
}

const CHUNK = 1000;

const EMAIL_RANK: Record<EmailStatus, number> = { deliverable: 3, catch_all: 2, unverified: 1, undeliverable: 0 };

/**
 * Voter files list one row per email address (District 23 repeats 12,305
 * voters this way). Keep one contact per person with their most deliverable
 * address, so nobody gets the same greeting at three addresses.
 */
export function betterRecord(a: ContactRecord, b: ContactRecord): ContactRecord {
  const rank = (r: ContactRecord) => (r.email ? EMAIL_RANK[r.email_status] + 1 : 0);
  return rank(b) > rank(a) ? b : a;
}

/**
 * Validates headers, normalizes every row and upserts on (tenant_id,
 * external_key) in chunks — one request per 1,000 rows instead of one huge
 * request that the API rejects. Rows repeated within the file collapse to
 * the last one (Postgres can't upsert the same key twice in one statement).
 */
export async function importRows(
  db: SupabaseClient,
  tenantId: string,
  rows: Record<string, unknown>[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
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
    return { ok: false, error: "No email or cell phone column found, so there's nothing to message." };
  }

  const byKey = new Map<string, ContactRecord>();
  let skipped = 0;
  for (const row of rows) {
    const rec = normalizeRow(row, mapping);
    if (!rec) {
      skipped++;
      continue;
    }
    const seen = byKey.get(rec.external_key);
    byKey.set(rec.external_key, seen ? betterRecord(seen, rec) : rec);
  }
  const records = [...byKey.values()];
  const now = new Date().toISOString();

  let imported = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK).map((r) => ({ ...r, tenant_id: tenantId, updated_at: now }));
    const { error } = await db.from("contacts").upsert(chunk, { onConflict: "tenant_id,external_key" });
    if (error) {
      return { ok: false, error: `Database error after ${imported} rows: ${error.message}`, rowsRead: rows.length, imported, skipped };
    }
    imported += chunk.length;
    onProgress?.(imported, records.length);
  }

  return {
    ok: true,
    rowsRead: rows.length,
    imported,
    skipped,
    duplicatesInFile: rows.length - skipped - records.length,
  };
}
