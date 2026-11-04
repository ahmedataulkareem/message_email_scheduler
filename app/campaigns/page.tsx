import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createCampaign } from "./actions";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { tenantId } = await requireMembership();
  const { error } = await searchParams;
  const db = supabaseAdmin();

  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, channel, subject, body, status, send_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <h1>Campaigns</h1>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New campaign</h2>
        <form action={createCampaign}>
          <label htmlFor="channel">Channel</label>
          <select id="channel" name="channel" defaultValue="email">
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>

          <label htmlFor="subject">Subject (email only)</label>
          <input id="subject" name="subject" placeholder="A message from your representative" />

          <label htmlFor="body">Message ({"{{first_name}}"} is replaced automatically)</label>
          <textarea id="body" name="body" rows={5} required placeholder="Hi {{first_name}}, ..." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="party">Party (optional)</label>
              <input id="party" name="party" placeholder="e.g. Democratic" />
            </div>
            <div>
              <label htmlFor="zip">Zip (optional)</label>
              <input id="zip" name="zip" placeholder="e.g. 21044" />
            </div>
            <div>
              <label htmlFor="min_age">Min age (optional)</label>
              <input id="min_age" name="min_age" type="number" />
            </div>
            <div>
              <label htmlFor="max_age">Max age (optional)</label>
              <input id="max_age" name="max_age" type="number" />
            </div>
          </div>

          <label htmlFor="send_at">Send at</label>
          <input id="send_at" name="send_at" type="datetime-local" />

          <button type="submit" style={{ marginTop: 16 }}>
            Submit for approval
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>All campaigns</h2>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Subject / body</th>
              <th>Status</th>
              <th>Send at</th>
            </tr>
          </thead>
          <tbody>
            {(campaigns ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.channel}</td>
                <td>
                  <a href={`/campaigns/${c.id}`}>{c.subject || c.body.slice(0, 40)}</a>
                </td>
                <td>
                  <span className="badge">{c.status}</span>
                </td>
                <td>{new Date(c.send_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
