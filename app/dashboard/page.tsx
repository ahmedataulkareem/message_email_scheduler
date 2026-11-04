import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

interface Row {
  channel: string;
  status: string;
}

function countBy(rows: Row[], key: "channel" | "status") {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
  return counts;
}

export default async function DashboardPage() {
  const { tenantId } = await requireMembership();
  const db = supabaseAdmin();

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ data: last7 }, { data: today }, { data: optOutsToday }, { data: failures }] = await Promise.all([
    db.from("messages").select("channel, status").eq("tenant_id", tenantId).gte("created_at", since7d),
    db.from("messages").select("channel, status").eq("tenant_id", tenantId).gte("created_at", todayStart.toISOString()),
    db.from("suppressions").select("channel").eq("tenant_id", tenantId).gte("created_at", todayStart.toISOString()),
    db
      .from("messages")
      .select("id, channel, to_addr, error, updated_at")
      .eq("tenant_id", tenantId)
      .in("status", ["failed", "bounced"])
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  const todayByStatus = countBy((today as Row[]) ?? [], "status");
  const last7ByChannel = countBy((last7 as Row[]) ?? [], "channel");
  const optOuts = (optOutsToday ?? []).length;

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Today</h2>
        {["queued", "sent", "delivered", "failed", "bounced"].map((status) => (
          <span className="stat" key={status}>
            <span className="n">{todayByStatus.get(status) ?? 0}</span>
            <span className="label">{status}</span>
          </span>
        ))}
        <span className="stat">
          <span className="n">{optOuts}</span>
          <span className="label">opt-outs</span>
        </span>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Last 7 days, by channel</h2>
        <span className="stat">
          <span className="n">{last7ByChannel.get("email") ?? 0}</span>
          <span className="label">email</span>
        </span>
        <span className="stat">
          <span className="n">{last7ByChannel.get("sms") ?? 0}</span>
          <span className="label">sms</span>
        </span>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent failures</h2>
        {failures && failures.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>To</th>
                <th>Error</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id}>
                  <td>{f.channel}</td>
                  <td>{f.to_addr}</td>
                  <td>{f.error}</td>
                  <td>{new Date(f.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No failures.</p>
        )}
      </div>
    </div>
  );
}
