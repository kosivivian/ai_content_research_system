import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineJob } from "../types/db.js";
import type { WorkerDeps } from "./loop.js";
import { logActivity, logError, notifyApproverOfError } from "./notifications.js";

export function createSupabaseWorkerDeps(
  supabase: SupabaseClient,
  opts: { maxAttempts: number },
): WorkerDeps {
  return {
    maxAttempts: opts.maxAttempts,

    async claimNextJob() {
      const { data, error } = await supabase.rpc("claim_next_pipeline_job");
      if (error) throw new Error(`claim_next_pipeline_job failed: ${error.message}`);
      const [job] = (data ?? []) as PipelineJob[];
      return job ?? null;
    },

    async markJobDone(jobId) {
      const { error } = await supabase.from("pipeline_jobs").update({ status: "done" }).eq("id", jobId);
      if (error) throw new Error(`markJobDone failed: ${error.message}`);
    },

    async markJobFailed(jobId) {
      const { error } = await supabase.from("pipeline_jobs").update({ status: "failed" }).eq("id", jobId);
      if (error) throw new Error(`markJobFailed failed: ${error.message}`);
    },

    async requeueJob(jobId) {
      const { error } = await supabase.from("pipeline_jobs").update({ status: "queued" }).eq("id", jobId);
      if (error) throw new Error(`requeueJob failed: ${error.message}`);
    },

    async advanceJob(job, nextStage) {
      const { error } = await supabase.rpc("advance_pipeline_job", {
        p_job_id: job.id,
        p_next_stage: nextStage,
      });
      if (error) throw new Error(`advanceJob failed: ${error.message}`);
    },

    async setRequestStatus(requestId, status) {
      const { error } = await supabase.from("content_requests").update({ status }).eq("id", requestId);
      if (error) throw new Error(`setRequestStatus failed: ${error.message}`);
    },

    logActivity: (requestId, action, detail = {}) => logActivity(supabase, requestId, action, detail),
    logError: (requestId, stage, detail) => logError(supabase, requestId, stage, detail),
    notifyApproverOfError: (requestId, stage, detail) => notifyApproverOfError(supabase, requestId, stage, detail),
  };
}
