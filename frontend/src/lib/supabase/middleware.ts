import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr -- server components can't refresh it themselves) and
 * redirects signed-out visitors away from anything but the public paths.
 * Role-specific gating (creator vs approver) happens per-page/per-route,
 * not here -- this only establishes "is there a session at all."
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    // API routes expect JSON, not an HTML redirect -- a fetch() caller
    // would otherwise try to parse the /login page as JSON and blow up
    // instead of seeing a clean 401. Route handlers still do their own
    // auth check too (this is defense in depth, not a replacement).
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
