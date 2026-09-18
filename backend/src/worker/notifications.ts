import type { SupabaseClient } from "@supabase/supabase-js";
import { sendErrorEmail } from "../clients/resend.js";

// Shared by supabaseDeps.ts (pipeline_jobs worker) and publishingDeps.ts
// (publishing_queue worker) -- both write to the same activity_log/
// error_logs tables and notify approvers the same way.

export async function logActivity(
  supabase: SupabaseClient,
  requestId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    request_id: requestId,
    actor_type: "ai_agent",
    action,
    detail,
  });
  if (error) throw new Error(`logActivity failed: ${error.message}`);
}

export async function logError(
  supabase: SupabaseClient,
  requestId: string,
  stage: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("error_logs").insert({ request_id: requestId, stage, detail });
  if (error) throw new Error(`logError failed: ${error.message}`);
}

export async function notifyApproverOfError(
  supabase: SupabaseClient,
  requestId: string,
  stage: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { data: approvers, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "approver")
    .eq("active", true);
  if (error) throw new Error(`notifyApproverOfError lookup failed: ${error.message}`);

  await Promise.all(
    (approvers ?? []).map((approver: { email: string }) =>
      sendErrorEmail(approver.email, { requestId, stage, detail }),
    ),
  );
}
