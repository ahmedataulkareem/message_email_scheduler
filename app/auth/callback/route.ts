import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/auth";

function toLogin(request: NextRequest, message: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
}

// Magic-link landing: swaps the one-time code for a session cookie.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const linkError = params.get("error_description");
  if (linkError) return toLogin(request, linkError);

  const code = params.get("code");
  if (!code) return toLogin(request, "Sign-in link is missing its code.");

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return toLogin(request, `${error.message}. Open the link in the same browser you requested it from.`);
  }
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
