import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * For Server Components, Server Actions, and Route Handlers. Still the
 * anon key + the current user's session (via cookies) -- RLS applies here
 * exactly as it does in the browser client. Use lib/supabase/admin.ts
 * (service role) only for the specific privileged actions that need it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component -- middleware already refreshes
          // the session cookie on the request/response pair, so this is
          // safe to ignore here.
        }
      },
    },
  });
}
