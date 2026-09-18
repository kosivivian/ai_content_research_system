import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../config/env.js";

let client: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS -- only ever used from the backend
 * worker, never exposed to the frontend.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const env = loadEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}
