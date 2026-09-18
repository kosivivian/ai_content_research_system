import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client -- bypasses RLS entirely. The `server-only` import
 * makes it a build error to ever import this from a Client Component.
 * Used exclusively by the account-management route handlers
 * (app/api/admin/**), which perform their own approver-role check before
 * touching this.
 */
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
