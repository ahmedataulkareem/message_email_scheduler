import { requireMembership } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import UploadForm from "./UploadForm";
import SearchBox from "./SearchBox";

// The upload server action runs in this page's function; a 60k-row file
// needs more than the default timeout once deployed.
export const maxDuration = 300;

export default async function ContactsPage() {
  const { tenantId } = await requireMembership();
  const db = supabaseAdmin();

  const base = () => db.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);

  const [{ count: total }, { count: withEmail }, { count: deliverable }, { count: withCell }, { count: consented }] =
    await Promise.all([
      base(),
      base().not("email", "is", null),
      base().eq("email_status", "deliverable"),
      base().not("cell_e164", "is", null),
      base().not("sms_consent_at", "is", null),
    ]);

  return (
    <div>
      <h1>Contacts</h1>

      <div className="card">
        <span className="stat">
          <span className="n">{total ?? 0}</span>
          <span className="label">total</span>
        </span>
        <span className="stat">
          <span className="n">{withEmail ?? 0}</span>
          <span className="label">with email</span>
        </span>
        <span className="stat">
          <span className="n">{deliverable ?? 0}</span>
          <span className="label">deliverable email</span>
        </span>
        <span className="stat">
          <span className="n">{withCell ?? 0}</span>
          <span className="label">with cell</span>
        </span>
        <span className="stat">
          <span className="n">{consented ?? 0}</span>
          <span className="label">SMS opted-in</span>
        </span>
      </div>

      <UploadForm />
      <SearchBox />
    </div>
  );
}
