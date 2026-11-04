import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { saveSettings } from "./actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { tenantId } = await requireAdmin();
  const { error, saved } = await searchParams;
  const db = supabaseAdmin();
  const { data: tenant } = await db.from("tenants").select("*").eq("id", tenantId).single();

  if (!tenant) return <p>Tenant not found.</p>;

  return (
    <div>
      <h1>Settings</h1>
      {error && <p className="error">{error}</p>}
      {saved && <p>Saved.</p>}

      <div className="card">
        <form action={saveSettings}>
          <label htmlFor="name">Organization name</label>
          <input id="name" name="name" defaultValue={tenant.name} required />

          <label htmlFor="timezone">Timezone</label>
          <input id="timezone" name="timezone" defaultValue={tenant.timezone} />

          <label htmlFor="from_email">From email</label>
          <input id="from_email" name="from_email" defaultValue={tenant.from_email} required />

          <label htmlFor="from_name">From name</label>
          <input id="from_name" name="from_name" defaultValue={tenant.from_name} />

          <label htmlFor="email_footer">Email footer (e.g. &quot;Paid for by ...&quot; authority line)</label>
          <textarea id="email_footer" name="email_footer" rows={2} defaultValue={tenant.email_footer} />

          <label htmlFor="sms_footer">SMS footer</label>
          <textarea id="sms_footer" name="sms_footer" rows={2} defaultValue={tenant.sms_footer} />

          <h3>Birthday templates</h3>
          <label htmlFor="birthday_email_subject">Email subject</label>
          <input id="birthday_email_subject" name="birthday_email_subject" defaultValue={tenant.birthday_email_subject} />

          <label htmlFor="birthday_email_body">Email body</label>
          <textarea id="birthday_email_body" name="birthday_email_body" rows={4} defaultValue={tenant.birthday_email_body} />

          <label htmlFor="birthday_sms_body">SMS body</label>
          <textarea id="birthday_sms_body" name="birthday_sms_body" rows={3} defaultValue={tenant.birthday_sms_body} />

          <button type="submit" style={{ marginTop: 16 }}>
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
