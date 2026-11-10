import { signInWithPassword, sendMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 400, margin: "60px auto" }}>
      <h1>Sign in</h1>
      {params.error && <p className="error">{params.error}</p>}

      {params.sent ? (
        <p>Check your email for a sign-in link. Open it in this same browser.</p>
      ) : (
        <>
          <form action={signInWithPassword}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
            <button type="submit" style={{ marginTop: 12 }}>
              Sign in
            </button>
          </form>
          <p className="muted">
            No account yet? In Supabase, go to Authentication → Users → Add user → Create new user, set a
            password and tick &quot;Auto Confirm User&quot;.
          </p>

          <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid #eee" }} />

          <form action={sendMagicLink}>
            <label htmlFor="link-email">Or email me a sign-in link</label>
            <input id="link-email" name="email" type="email" required />
            <button type="submit" className="secondary" style={{ marginTop: 12 }}>
              Send link
            </button>
          </form>
          <p className="muted">Supabase&apos;s built-in mailer only allows a few links per hour.</p>
        </>
      )}
    </div>
  );
}
