"use client";

import { useState, useTransition } from "react";
import { searchContacts } from "./actions";

type Contact = Awaited<ReturnType<typeof searchContacts>>[number];

export default function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    setQuery(value);
    startTransition(async () => {
      setResults(value.trim() ? await searchContacts(value) : []);
    });
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Search</h2>
      <input placeholder="Name, email or phone" value={query} onChange={(e) => onChange(e.target.value)} />
      {pending && <p className="muted">Searching…</p>}
      {results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Cell</th>
              <th>Party</th>
              <th>Zip</th>
            </tr>
          </thead>
          <tbody>
            {results.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.first_name} {c.last_name}
                </td>
                <td>{c.email}</td>
                <td>{c.cell_e164}</td>
                <td>{c.party}</td>
                <td>{c.zip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
