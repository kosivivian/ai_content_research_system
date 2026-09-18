import type { ContentRequestStatus } from "../types/db.js";

// Canonical stage names used in pipeline_jobs.stage. The column is plain
// text (not a DB check constraint) so new stages can be added without a
// migration -- this const is the single source of truth on the app side.
export const STAGES = [
  "intake",
  "research",
  "retrieve",
  "rerank",
  "plan",
  "generate",
  "evaluate_article",
  "channel_adapt",
  "evaluate_channel",
  "regenerate_article",
  "regenerate_channel",
] as const;

export type Stage = (typeof STAGES)[number];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

/**
 * The default stage to queue next after `stage` completes successfully.
 * evaluate_article and evaluate_channel don't have a single static
 * successor -- their handlers always return an explicit `nextStage`
 * override on their StageResult (back to the drafting stage on a revise
 * verdict, forward otherwise), so `null` here is never actually used for
 * them; it's just what a bug that forgot to set nextStage would fall back
 * to (job marked done, not silently misrouted).
 */
export const NEXT_STAGE: Record<Stage, Stage | null> = {
  intake: "research",
  research: "retrieve",
  retrieve: "rerank",
  rerank: "plan",
  plan: "generate",
  generate: "evaluate_article",
  evaluate_article: null,
  channel_adapt: "evaluate_channel",
  evaluate_channel: null,
  // Both are one-shot: the creator triggers them directly (not part of the
  // automated chain), a single AI call updates the existing draft/channel
  // row in place, done.
  regenerate_article: null,
  regenerate_channel: null,
};

/**
 * content_requests.status to show while a job for that stage is in
 * flight -- set generically by the worker loop when it claims a job (see
 * loop.ts), not by each stage handler. The schema only has one status per
 * "family" of work, so channel_adapt/evaluate_channel share generating/
 * evaluating with the article stages rather than getting their own values.
 * A stage's own handler can still overwrite this at the end of its run
 * (e.g. evaluate_channel setting 'awaiting_creator' once the pipeline is
 * actually done).
 *
 * Partial, not total: regenerate_article/regenerate_channel deliberately
 * have no entry. They're one-shot actions the creator triggers directly
 * while a request is awaiting_creator/changes_requested -- the request
 * should visibly stay in that same status throughout (it's still "awaiting
 * the creator", just with one component quietly being refreshed), not flip
 * to some in-progress status and back.
 */
export const STAGE_STATUS: Partial<Record<Stage, ContentRequestStatus>> = {
  intake: "intake",
  research: "researching",
  retrieve: "retrieving",
  rerank: "reranking",
  plan: "planning",
  generate: "generating",
  evaluate_article: "evaluating",
  channel_adapt: "generating",
  evaluate_channel: "evaluating",
};
