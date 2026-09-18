import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/db";

/**
 * The signed-in user's profile (role, active flag), for Server
 * Components/layouts to gate content. Returns null if there's no session
 * -- middleware already redirects unauthenticated visitors to /login
 * before most pages render, so this mainly matters for role checks.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile) ?? null;
}
