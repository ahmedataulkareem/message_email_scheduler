import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { addSuppression, bulkAddSuppressions, removeSuppression } from "./actions";

export default async function SuppressionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { tenantId } = await requireMembership();
  const { error } = await searchParams;
  const db = supabaseAdmin();

  const { data: rows } = await db
    .from("suppressions")
    .select("channel, value, reason, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <h1>Suppressions (do-not-contact list)</h1>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        Checked before every send. STOP replies and email unsubscribe links add to this list automatically.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add one</h2>
        <form action={addSuppression}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 12, alignItems: "end" }}>
            <div>
              <label htmlFor="channel">Channel</label>
              <select id="channel" name="channel" defaultValue="email">
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div>
              <label htmlFor="value">Address or phone</label>
              <input id="value" name="value" required />
            </div>
            <div>
              <label htmlFor="reason">Reason</label>
              <input id="reason" name="reason" placeholder="requested" />
            </div>
            <button type="submit">Add</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Bulk add</h2>
        <p className="muted">One per line: channel,value,reason — e.g. email,pat@example.com,requested</p>
        <form action={bulkAddSuppressions}>
          <textarea name="lines" rows={5} placeholder={"email,pat@example.com,requested\nsms,+14105550101,requested"} />
          <button type="submit" style={{ marginTop: 12 }}>
            Add all
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>List</h2>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Value</th>
              <th>Reason</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={`${r.channel}-${r.value}`}>
                <td>{r.channel}</td>
                <td>{r.value}</td>
                <td>{r.reason}</td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
                <td>
                  <form action={removeSuppression}>
                    <input type="hidden" name="channel" value={r.channel} />
                    <input type="hidden" name="value" value={r.value} />
                    <button type="submit" className="secondary">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
