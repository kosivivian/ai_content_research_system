import type { PipelineJob, Brief } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { weightedScore, ARTICLE_RUBRIC_WEIGHTS, MAX_AUTO_REVISE_ITERATIONS, type EvaluationDetail } from "./rubric.js";
import { createEvaluateArticleDeps } from "./evaluateArticleDeps.js";

export type EvaluationVerdict = "pass" | "revise" | "reject";

export interface DraftForEvaluation {
  id: string;
  optionNumber: number;
  bodyMarkdown: string;
}

export interface DraftEvaluation {
  optionNumber: number;
  detail: EvaluationDetail;
  overallStatus: EvaluationVerdict;
  notes: string;
}

export interface EvaluateArticleDeps {
  getBrief(requestId: string): Promise<Brief>;
  /** The latest version's drafts (all NUM_DRAFT_OPTIONS of them) plus that version number. */
  getLatestDrafts(requestId: string): Promise<{ version: number; drafts: DraftForEvaluation[] }>;
  evaluateDrafts(
    brief: Brief,
    drafts: DraftForEvaluation[],
  ): Promise<{ evaluations: DraftEvaluation[]; tokensUsed: number }>;
  storeEvaluations(
    requestId: string,
    version: number,
    drafts: DraftForEvaluation[],
    evaluations: DraftEvaluation[],
  ): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Evaluate_article stage: scores every draft option against the rubric
 * (minus Channel Fit, which doesn't apply yet) and decides where the
 * pipeline goes next -- this is the stage that actually drives the
 * revise loop via an explicit nextStage override, not a static chain.
 */
export async function runEvaluateArticle(job: PipelineJob, deps: EvaluateArticleDeps): Promise<StageResult> {
  const brief = await deps.getBrief(job.request_id);
  const { version, drafts } = await deps.getLatestDrafts(job.request_id);

  if (drafts.length === 0) {
    throw new Error(`evaluate_article: no article_drafts found for request ${job.request_id}`);
  }

  const { evaluations, tokensUsed } = await deps.evaluateDrafts(brief, drafts);
  await deps.storeEvaluations(job.request_id, version, drafts, evaluations);

  const best = pickBest(evaluations);
  const hitIterationCap = version >= MAX_AUTO_REVISE_ITERATIONS;
  const shouldRevise = best.overallStatus !== "pass" && !hitIterationCap;
  const needsManualAttention = best.overallStatus !== "pass" && hitIterationCap;

  await deps.logActivity(job.request_id, "article_evaluated", {
    version,
    bestOptionNumber: best.optionNumber,
    overallStatus: best.overallStatus,
    needsManualAttention,
  });

  return {
    nextAction: "advance",
    nextStage: shouldRevise ? "generate" : "channel_adapt",
    tokensUsed,
  };
}

function pickBest(evaluations: DraftEvaluation[]): DraftEvaluation {
  const byStatus = (status: EvaluationVerdict) => evaluations.filter((e) => e.overallStatus === status);
  const bestOf = (pool: DraftEvaluation[]) =>
    pool.reduce((a, b) =>
      weightedScore(a.detail.scores, ARTICLE_RUBRIC_WEIGHTS) >= weightedScore(b.detail.scores, ARTICLE_RUBRIC_WEIGHTS)
        ? a
        : b,
    );

  const passing = byStatus("pass");
  if (passing.length > 0) return bestOf(passing);

  const revising = byStatus("revise");
  if (revising.length > 0) return bestOf(revising);

  return bestOf(evaluations); // everything rejected -- still forward the least-bad option
}

registerStage("evaluate_article", (job) => runEvaluateArticle(job, createEvaluateArticleDeps()));
