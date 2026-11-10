import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { runBirthdaysNow, sendNow } from "./actions";

const PERIODS = {
  day: { label: "Last 24 hours", days: 1 },
  week: { label: "Last 7 days", days: 7 },
  month: { label: "Last 30 days", days: 30 },
} as const;
type Period = keyof typeof PERIODS;

const COLUMNS = ["queued", "sent", "delivered", "failed", "bounced", "complained", "undelivered", "skipped"] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; ran?: string; error?: string }>;
}) {
  const { tenantId, role } = await requireMembership();
  const params = await searchParams;
  const period: Period = params.period && params.period in PERIODS ? (params.period as Period) : "day";
  const since = new Date(Date.now() - PERIODS[period].days * 86_400_000).toISOString();
  const db = supabaseAdmin();

  const [{ data: stats }, { count: optOuts }, { data: birthdays }, { data: recent }, { count: pending }] =
    await Promise.all([
      db.rpc("message_stats", { p_tenant_id: tenantId, p_since: since }),
      db.from("suppressions").select("value", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", since),
      db.rpc("birthdays_today", { p_tenant_id: tenantId }),
      db
        .from("messages")
        .select("id, channel, to_addr, status, error, updated_at, campaign_id")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(20),
      db.from("campaigns").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending"),
    ]);

  const rows = (stats ?? []) as { channel: string; status: string; n: number }[];
  const count = (channel: string, status?: string) =>
    rows.filter((r) => r.channel === channel && (!status || r.status === status)).reduce((s, r) => s + r.n, 0);
  const canRun = role === "admin" || role === "approver";

  return (
    <div>
      <h1>Dashboard</h1>
      {params.error && <p className="error">{params.error}</p>}
      {params.ran && <p className="notice">{params.ran}</p>}

      <div className="card">
        <span className="stat">
          <span className="n">{(birthdays as number | null) ?? 0}</span>
          <span className="label">birthdays today</span>
        </span>
        <span className="stat">
          <span className="n">{pending ?? 0}</span>
          <span className="label">campaigns awaiting approval</span>
        </span>
        <span className="stat">
          <span className="n">{optOuts ?? 0}</span>
          <span className="label">opt-outs ({PERIODS[period].label.toLowerCase()})</span>
        </span>

        {canRun && (
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <form action={runBirthdaysNow}>
              <button type="submit">Queue today&apos;s birthdays</button>
            </form>
            <form action={sendNow}>
              <button type="submit">Send queued messages now</button>
            </form>
          </div>
        )}
        <p className="muted">
          In production these run on their own (birthdays daily, sending every minute). The buttons run the same jobs
          immediately, which is how you test locally.
        </p>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Delivery report</h2>
          <div style={{ display: "flex", gap: 12, fontSize: 14 }}>
            {(Object.keys(PERIODS) as Period[]).map((p) =>
              p === period ? (
                <strong key={p}>{PERIODS[p].label}</strong>
              ) : (
                <a key={p} href={`/dashboard?period=${p}`}>
                  {PERIODS[p].label}
                </a>
              )
            )}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Scheduled</th>
              {COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["email", "sms"].map((channel) => (
              <tr key={channel}>
                <td>{channel}</td>
                <td>{count(channel)}</td>
                {COLUMNS.map((c) => (
                  <td key={c}>{count(channel, c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          &quot;delivered&quot; needs the provider webhooks, which only reach a deployed app; locally a sent message stays
          &quot;sent&quot;. &quot;skipped&quot; = not on SEND_ALLOWLIST (test mode).
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent messages</h2>
        {recent && recent.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Channel</th>
                <th>To</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td>{m.campaign_id ? <a href={`/campaigns/${m.campaign_id}`}>campaign</a> : "birthday"}</td>
                  <td>{m.channel}</td>
                  <td>{m.to_addr}</td>
                  <td>
                    <span className="badge">{m.status}</span>
                  </td>
                  <td className={m.status === "failed" ? "error" : "muted"}>{m.error}</td>
                  <td>{new Date(m.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No messages yet. Press &quot;Queue today&apos;s birthdays&quot; to create some.</p>
        )}
      </div>
    </div>
  );
}
