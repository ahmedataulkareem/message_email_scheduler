// Column-alias matching + row normalization for uploading a voter/contact
// Excel file with a "similar" structure through the app — not just the
// one-time District 23 seed (scripts/import.sql), which expects that file's
// exact 54-column layout. This is for whatever a customer sends next.

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

/** US 10-digit number to E.164. Returns null if it can't be made into one. */
export function normalizeCell(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function normalizeBirthdate(raw: unknown): string | null {
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

  return {
    voter_id: str(byKey.get("voter_id")),
    first_name: str(byKey.get("first_name")),
    last_name: str(byKey.get("last_name")),
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
