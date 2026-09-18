import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Account creation is the one action in this app that genuinely needs the
 * service role key (inserting into auth.users isn't reachable through
 * RLS/PostgREST at all) -- so it's the one place we need a server route
 * instead of a direct client-side Supabase call. Deactivating/reactivating
 * an existing account doesn't need this: the profiles RLS policy already
 * lets an approver update any profile row directly.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  if (!profile || profile.role !== "approver" || !profile.active) {
    return NextResponse.json({ error: "Only an active approver can create accounts." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: string; role?: string } | null;
  const email = body?.email?.trim();
  const role = body?.role;

  if (!email || (role !== "creator" && role !== "approver")) {
    return NextResponse.json({ error: 'Provide "email" and role ("creator" or "approver").' }, { status: 400 });
  }

  const tempPassword = randomBytes(9).toString("base64url");
  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { role },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    userId: created.user.id,
    email,
    role,
    tempPassword,
  });
}
