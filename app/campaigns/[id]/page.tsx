import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { render, fillName, type Tenant } from "@/lib/send";
import { approveCampaign } from "../actions";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantId, role } = await requireMembership();
  const db = supabaseAdmin();

  const STATUSES = ["queued", "sending", "sent", "delivered", "failed", "bounced", "complained", "undelivered", "skipped"];
  const [{ data: campaign }, { data: tenant }, ...counts] = await Promise.all([
    db.from("campaigns").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("*").eq("id", tenantId).single(),
    // Counted per status, not by fetching rows (a plain select stops at 1,000).
    ...STATUSES.map((s) =>
      db.from("messages").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("status", s)
    ),
  ]);

  if (!campaign) return <p>Campaign not found.</p>;

  const statusCounts = new Map<string, number>();
  STATUSES.forEach((s, i) => {
    const n = counts[i].count ?? 0;
    if (n > 0) statusCounts.set(s, n);
  });

  const preview =
    campaign.channel === "email"
      ? render(campaign.body, { first_name: "Pat" }, tenant as Tenant, "email")
      : render(campaign.body, { first_name: "Pat" }, tenant as Tenant, "sms");
  const previewSubject = campaign.subject ? fillName(campaign.subject, { first_name: "Pat" }) : null;

  const canApprove = (role === "admin" || role === "approver") && campaign.status === "pending";
  const approve = approveCampaign.bind(null, campaign.id as string);

  return (
    <div>
      <h1>Campaign</h1>
      <div className="card">
        <p>
          <span className="badge">{campaign.channel}</span> <span className="badge">{campaign.status}</span>
        </p>
        <p className="muted">
          Send at {new Date(campaign.send_at).toLocaleString("en-US", { timeZone: tenant.timezone })} ({tenant.timezone})
        </p>
        {campaign.status === "approved" && (
          <p className="notice">
            Approved. It goes out on the next send run once the send time has passed: within a minute when deployed,
            or press &quot;Send queued messages now&quot; on the Dashboard.
          </p>
        )}

        <h3>Preview (sample recipient: Pat)</h3>
        {previewSubject && (
          <p>
            <strong>Subject:</strong> {previewSubject}
          </p>
        )}
        <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 12, borderRadius: 6 }}>{preview}</pre>

        <h3>Audience filter</h3>
        <pre>{JSON.stringify(campaign.audience, null, 2)}</pre>

        {canApprove && (
          <form action={approve}>
            <button type="submit">Approve</button>
          </form>
        )}
        {!canApprove && campaign.status === "pending" && (
          <p className="muted">Only an approver or admin can approve this campaign.</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Delivery</h3>
        {statusCounts.size === 0 ? (
          <p className="muted">Not enqueued yet.</p>
        ) : (
          [...statusCounts.entries()].map(([status, n]) => (
            <span className="stat" key={status}>
              <span className="n">{n}</span>
              <span className="label">{status}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
