import { sendMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 360, margin: "60px auto" }}>
      <h1>Sign in</h1>
      {params.sent ? (
        <p>Check your email for a sign-in link.</p>
      ) : (
        <form action={sendMagicLink}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com" />
          <button type="submit" style={{ marginTop: 12 }}>
            Send link
          </button>
        </form>
      )}
      {params.error && <p className="error">{params.error}</p>}
    </div>
  );
}
