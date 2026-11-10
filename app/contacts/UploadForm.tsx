"use client";

import { useState, useTransition } from "react";
import { uploadContacts } from "./actions";
import type { ImportResult } from "@/lib/contacts-import";

export default function UploadForm() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await uploadContacts(formData);
      setResult(res);
    });
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Upload a contact file</h2>
      <p className="muted">
        .xlsx, .xls or .csv. Columns are matched by name (e.g. &quot;First Name&quot; or &quot;Voters_FirstName&quot;
        both work) — the file doesn&apos;t need to match District 23&apos;s layout exactly, but it does need a first
        name, a last name, and an email or cell phone column. Re-uploading the same people updates them instead of
        duplicating them.
      </p>
      <form action={handleSubmit}>
        <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
        <button type="submit" disabled={pending} style={{ marginTop: 12 }}>
          {pending ? "Uploading… a large file takes a minute or two" : "Upload"}
        </button>
      </form>
      {result && (
        <div style={{ marginTop: 12 }}>
          {result.ok ? (
            <p className="notice">
              Read {result.rowsRead} rows → {result.imported} contacts saved. {result.duplicatesInFile} rows were
              extra email addresses for someone already in the file (kept their best address);{" "}
              {result.skipped} had no email or phone.
            </p>
          ) : (
            <div>
              <p className="error">{result.error}</p>
              {result.unmatchedHeaders && result.unmatchedHeaders.length > 0 && (
                <p className="muted">Columns we didn&apos;t recognize: {result.unmatchedHeaders.join(", ")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
