import { createBrowserClient } from "@supabase/ssr";

/**
 * For Client Components. Uses the anon key -- every query through this
 * client is bound by the RLS policies in supabase/migrations, not just
 * hidden by the UI. Never use the service role key here.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
