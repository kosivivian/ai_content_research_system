import type { PipelineJob } from "../types/db.js";
import { STAGES, type Stage } from "../pipeline/stages.js";

export interface StageResult {
  /**
   * "advance"      -> move on to `nextStage` if given, else NEXT_STAGE[job.stage] (or mark done if neither)
   * "requeue_self" -> re-run this same stage immediately (rarely used by a handler directly; this is how the loop's own retry-on-failure works)
   * "stop"         -> mark done, no successor queued (e.g. parked awaiting a human)
   */
  nextAction: "advance" | "requeue_self" | "stop";
  /**
   * Overrides the static NEXT_STAGE lookup for this "advance" -- used for
   * data-dependent routing, e.g. evaluate_article sending a "revise"
   * verdict back to "generate" instead of following the static forward
   * chain, or a "pass" verdict forward to "channel_adapt".
   */
  nextStage?: Stage;
  tokensUsed?: number;
}

export type StageHandler = (job: PipelineJob) => Promise<StageResult>;

const handlers = new Map<Stage, StageHandler>();

export function registerStage(stage: Stage, handler: StageHandler): void {
  handlers.set(stage, handler);
}

export function getHandler(stage: Stage): StageHandler {
  const handler = handlers.get(stage);
  if (!handler) {
    throw new Error(`No handler registered for stage "${stage}"`);
  }
  return handler;
}

// Every stage gets a placeholder up front so the worker loop is runnable
// end-to-end today. Later build steps replace these one at a time via
// registerStage(...) -- e.g. the intake stage lands in src/pipeline/intake.ts
// and calls registerStage("intake", handleIntake).
for (const stage of STAGES) {
  registerStage(stage, async () => {
    throw new Error(`Stage "${stage}" is not implemented yet`);
  });
}
