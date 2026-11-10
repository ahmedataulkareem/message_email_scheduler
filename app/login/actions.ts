"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/auth";

function loginError(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) loginError("Enter your email and password.");

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) loginError(error.message);
  redirect("/dashboard");
}

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  if (!email) loginError("Enter an email address.");

  // The client stores a PKCE verifier cookie here; /auth/callback needs it to
  // finish sign-in, so the link must be opened in this same browser.
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${process.env.APP_URL}/auth/callback`, shouldCreateUser: false },
  });
  if (error) loginError(error.message);
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
