import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
// No `ws` import here: this file runs on the Edge runtime, which already has
// a native WebSocket global (unlike the Node runtime the rest of the app
// uses) — see lib/supabase.ts for why other files need the polyfill.

// Refreshes the Supabase session cookie on every page request so a long-lived
// browser session doesn't suddenly expire mid-visit. Webhooks, cron and the
// public join/unsubscribe routes don't carry a user session, so they're
// excluded below rather than paying for a no-op refresh on every call.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|api/unsubscribe|join|login|auth).*)",
  ],
};
