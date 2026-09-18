import type { ContentRequestStatus, PipelineJob } from "../types/db.js";
import { getHandler } from "./registry.js";
import { isStage, NEXT_STAGE, STAGE_STATUS } from "../pipeline/stages.js";

export interface WorkerDeps {
  claimNextJob: () => Promise<PipelineJob | null>;
  markJobDone: (jobId: string) => Promise<void>;
  markJobFailed: (jobId: string) => Promise<void>;
  /** Sends the job back to "queued" without changing its stage (retry, or an evaluation revise loop). */
  requeueJob: (jobId: string) => Promise<void>;
  /** Atomically marks `job` done and enqueues `nextStage` for the same request. */
  advanceJob: (job: PipelineJob, nextStage: string) => Promise<void>;
  /** Reflects "what's happening right now" on content_requests.status for the dashboard; a stage's own handler may overwrite this again before it finishes (e.g. evaluate_channel setting 'awaiting_creator'). */
  setRequestStatus: (requestId: string, status: ContentRequestStatus) => Promise<void>;
  logActivity: (requestId: string, action: string, detail?: Record<string, unknown>) => Promise<void>;
  logError: (requestId: string, stage: string, detail: Record<string, unknown>) => Promise<void>;
  notifyApproverOfError: (requestId: string, stage: string, detail: Record<string, unknown>) => Promise<void>;
  maxAttempts: number;
}

export type TickResult = "processed" | "idle";

/**
 * Claims and processes a single job, if one is available. Pure enough to
 * unit test with fake deps -- no direct network/DB access in here.
 */
export async function runOneTick(deps: WorkerDeps): Promise<TickResult> {
  const job = await deps.claimNextJob();
  if (!job) return "idle";

  if (!isStage(job.stage)) {
    await deps.logError(job.request_id, job.stage, { reason: `Unknown stage "${job.stage}"` });
    await deps.markJobFailed(job.id);
    return "processed";
  }

  const stageStatus = STAGE_STATUS[job.stage];
  if (stageStatus) {
    await deps.setRequestStatus(job.request_id, stageStatus);
  }

  try {
    const handler = getHandler(job.stage);
    const result = await handler(job);

    await deps.logActivity(job.request_id, `stage_completed:${job.stage}`, {
      tokensUsed: result.tokensUsed ?? 0,
    });

    if (result.nextAction === "requeue_self") {
      await deps.requeueJob(job.id);
    } else if (result.nextAction === "advance") {
      const next = result.nextStage ?? NEXT_STAGE[job.stage];
      if (next) {
        await deps.advanceJob(job, next);
      } else {
        await deps.markJobDone(job.id);
      }
    } else {
      await deps.markJobDone(job.id);
    }
  } catch (err) {
    const detail = { message: err instanceof Error ? err.message : String(err) };
    await deps.logError(job.request_id, job.stage, detail);

    if (job.attempt_count >= deps.maxAttempts) {
      await deps.markJobFailed(job.id);
      // Otherwise content_requests.status is stuck on whatever STAGE_STATUS
      // set it to at claim time (e.g. "researching") forever -- looking
      // like it's still in progress instead of visibly stuck. This is also
      // what the "Errored" dashboard bucket and the error_logs count key
      // off of, so without it both silently under-report.
      await deps.setRequestStatus(job.request_id, "errored");
      await deps.notifyApproverOfError(job.request_id, job.stage, detail);
    } else {
      // Back to "queued" with the same stage; claim_next_pipeline_job()
      // bumps attempt_count again on the next claim.
      await deps.requeueJob(job.id);
    }
  }

  return "processed";
}

export interface RunWorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
}

/**
 * Runs `concurrency` independent polling slots until `signal` aborts.
 * Each slot claims one job at a time, so at most `concurrency` requests
 * are ever in flight (matches the "up to 5 concurrent requests" requirement).
 */
export async function runWorker(deps: WorkerDeps, opts: RunWorkerOptions): Promise<void> {
  let stopped = false;
  opts.signal?.addEventListener("abort", () => {
    stopped = true;
  });

  async function slot(): Promise<void> {
    while (!stopped) {
      let result: TickResult;
      try {
        result = await runOneTick(deps);
      } catch (err) {
        console.error("Unhandled error in worker tick:", err);
        result = "idle";
      }
      if (result === "idle") {
        await sleep(opts.pollIntervalMs);
      }
    }
  }

  await Promise.all(Array.from({ length: opts.concurrency }, () => slot()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
