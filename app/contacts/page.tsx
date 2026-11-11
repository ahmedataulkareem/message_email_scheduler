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

  const { data, error } = await db.rpc("contact_stats", { p_tenant_id: tenantId }).single();
  const stats = data as Record<string, number> | null;
  const tiles: [string, string][] = [
    ["total", "total"],
    ["with_email", "with email"],
    ["deliverable", "deliverable email"],
    ["with_cell", "with cell"],
    ["sms_opted_in", "SMS opted-in"],
    ["with_birthdate", "with birthdate"],
  ];

  return (
    <div>
      <h1>Contacts</h1>

      <div className="card">
        {error && <p className="error">Couldn&apos;t load totals: {error.message}</p>}
        {tiles.map(([key, label]) => (
          <span className="stat" key={key}>
            <span className="n">{stats?.[key] ?? 0}</span>
            <span className="label">{label}</span>
          </span>
        ))}
      </div>

      <UploadForm />
      <SearchBox />
    </div>
  );
}
