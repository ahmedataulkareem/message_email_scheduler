// Import a contact spreadsheet from the command line — same code path as the
// /contacts upload, for files too big to upload through the browser.
//
//   npm run import-contacts -- "C:\path\District23.xlsx"            (writes)
//   npm run import-contacts -- "C:\path\District23.xlsx" --dry-run  (counts only)
import fs from "node:fs";
import {
  parseWorkbook,
  importRows,
  mapHeaders,
  normalizeRow,
  betterRecord,
  type ContactRecord,
} from "../lib/contacts-import";
import { supabaseAdmin } from "../lib/supabase";

async function main() {
const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error('usage: npm run import-contacts -- <file.xlsx> [--dry-run]');
  process.exit(1);
}

const rows = parseWorkbook(fs.readFileSync(path));
console.log(`read ${rows.length} rows`);

if (flag === "--dry-run") {
  const mapping = mapHeaders(Object.keys(rows[0] ?? {}));
  console.log("matched columns:", Object.fromEntries(Object.entries(mapping).filter(([, k]) => k)));
  const normalized = rows.map((r) => normalizeRow(r, mapping)).filter((r) => r !== null);
  const people = new Map<string, ContactRecord>();
  for (const r of normalized) {
    const seen = people.get(r.external_key);
    people.set(r.external_key, seen ? betterRecord(seen, r) : r);
  }
  const recs = [...people.values()];
  const cells = recs.map((r) => r.cell_e164).filter(Boolean);
  console.log({
    rowsWithEmailOrCell: normalized.length,
    skippedNoEmailOrCell: rows.length - normalized.length,
    contactsAfterMerge: recs.length,
    withEmail: recs.filter((r) => r.email).length,
    deliverableEmail: recs.filter((r) => r.email_status === "deliverable").length,
    withCell: cells.length,
    uniqueCells: new Set(cells).size,
    withBirthdate: recs.filter((r) => r.birthdate).length,
    sampleBirthdates: recs.slice(0, 3).map((r) => r.birthdate),
  });
} else {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID not set (is .env.local loaded?)");
  const result = await importRows(supabaseAdmin(), tenantId, rows, (done, total) =>
    process.stdout.write(`\rimported ${done}/${total}`)
  );
  console.log("\n", result);
  if (!result.ok) process.exit(1);
}
}

main();
