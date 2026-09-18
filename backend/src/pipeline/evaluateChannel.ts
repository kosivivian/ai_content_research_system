import type { PipelineJob, Brief, Channel } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { MAX_AUTO_REVISE_ITERATIONS, type EvaluationDetail } from "./rubric.js";
import { createEvaluateChannelDeps } from "./evaluateChannelDeps.js";

export type EvaluationVerdict = "pass" | "revise" | "reject";

export interface ChannelDraftForEvaluation {
  id: string;
  channel: Channel;
  body: string;
}

export interface ChannelEvaluation {
  channel: Channel;
  detail: EvaluationDetail;
  overallStatus: EvaluationVerdict;
  notes: string;
}

export interface EvaluateChannelDeps {
  getBrief(requestId: string): Promise<Brief>;
  getLatestChannelDrafts(requestId: string): Promise<{ version: number; drafts: ChannelDraftForEvaluation[] }>;
  evaluateChannelDrafts(
    brief: Brief,
    drafts: ChannelDraftForEvaluation[],
  ): Promise<{ evaluations: ChannelEvaluation[]; tokensUsed: number }>;
  storeEvaluations(
    requestId: string,
    version: number,
    drafts: ChannelDraftForEvaluation[],
    evaluations: ChannelEvaluation[],
  ): Promise<void>;
  /** The pipeline's terminal transition -- this is "return to creator" (plan step 9), whether the drafts cleanly passed or hit the revision cap. */
  markAwaitingCreator(requestId: string, needsManualAttention: boolean): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Evaluate_channel stage: scores every channel draft (Channel Fit, Tone,
 * Clarity) and either sends the whole batch back to channel_adapt for
 * revision, or -- once every channel passes, or the revision cap is hit --
 * hands the request back to the creator. This is the last automated
 * stage in the pipeline.
 */
export async function runEvaluateChannel(job: PipelineJob, deps: EvaluateChannelDeps): Promise<StageResult> {
  const brief = await deps.getBrief(job.request_id);
  const { version, drafts } = await deps.getLatestChannelDrafts(job.request_id);

  if (drafts.length === 0) {
    throw new Error(`evaluate_channel: no channel_drafts found for request ${job.request_id}`);
  }

  const { evaluations, tokensUsed } = await deps.evaluateChannelDrafts(brief, drafts);
  await deps.storeEvaluations(job.request_id, version, drafts, evaluations);

  const anyNotPass = evaluations.some((e) => e.overallStatus !== "pass");
  const hitIterationCap = version >= MAX_AUTO_REVISE_ITERATIONS;
  const shouldRevise = anyNotPass && !hitIterationCap;
  const needsManualAttention = anyNotPass && hitIterationCap;

  await deps.logActivity(job.request_id, "channel_drafts_evaluated", {
    version,
    results: evaluations.map((e) => ({ channel: e.channel, overallStatus: e.overallStatus })),
    needsManualAttention,
  });

  if (shouldRevise) {
    return { nextAction: "advance", nextStage: "channel_adapt", tokensUsed };
  }

  await deps.markAwaitingCreator(job.request_id, needsManualAttention);
  return { nextAction: "advance", tokensUsed };
}

registerStage("evaluate_channel", (job) => runEvaluateChannel(job, createEvaluateChannelDeps()));
