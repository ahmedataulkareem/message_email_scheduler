import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { render, fillName, type Tenant } from "@/lib/send";
import { approveCampaign } from "../actions";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantId, role } = await requireMembership();
  const db = supabaseAdmin();

  const [{ data: campaign }, { data: tenant }, { data: statusRows }] = await Promise.all([
    db.from("campaigns").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("*").eq("id", tenantId).single(),
    db.from("messages").select("status").eq("campaign_id", id),
  ]);

  if (!campaign) return <p>Campaign not found.</p>;

  const statusCounts = new Map<string, number>();
  for (const row of statusRows ?? []) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);

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
        <p className="muted">Send at {new Date(campaign.send_at).toLocaleString()}</p>

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
