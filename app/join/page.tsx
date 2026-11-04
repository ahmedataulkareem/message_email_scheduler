import { joinSms } from "./actions";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; joined?: string }>;
}) {
  const { error, joined } = await searchParams;

  return (
    <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
      <h1>Get text updates</h1>
      {joined ? (
        <p>You&apos;re signed up. Reply STOP at any time to opt out.</p>
      ) : (
        <>
          <form action={joinSms}>
            <label htmlFor="first_name">First name</label>
            <input id="first_name" name="first_name" required />

            <label htmlFor="last_name">Last name</label>
            <input id="last_name" name="last_name" />

            <label htmlFor="phone">Cell phone</label>
            <input id="phone" name="phone" type="tel" required placeholder="(410) 555-0101" />

            <label htmlFor="email">Email (optional)</label>
            <input id="email" name="email" type="email" />

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 16 }}>
              <input type="checkbox" name="consent" style={{ width: "auto", marginTop: 3 }} />
              <span style={{ fontSize: 13, fontWeight: 400 }}>
                I agree to receive text messages, including automated messages, at the number above. Message and
                data rates may apply. Reply STOP to opt out, HELP for help.
              </span>
            </label>

            <button type="submit" style={{ marginTop: 16 }}>
              Sign up
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
