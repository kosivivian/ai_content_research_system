import type { PipelineJob } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import type { Outline, RankedSourceForPlanning } from "./plan.js";
import { createGenerateDeps } from "./generateDeps.js";

/** One draft, not several -- the evaluate_article revise loop already gives a mechanism to fix a weak draft iteratively, so generating extra parallel options added cost without a proportionate quality gain. */
export const NUM_DRAFT_OPTIONS = 1;

/** Keeps output cost predictable and bounded -- 900-1300 words is a normal SEO blog-post length, not a truncation workaround. */
export const TARGET_WORD_RANGE = { min: 900, max: 1300 } as const;

export interface RevisionFeedback {
  notes: string;
  weakClaims: string[];
  sectionsNeedingRevision: string[];
}

export interface DraftOption {
  optionNumber: number;
  bodyMarkdown: string;
  /** source_materials ids actually cited, already resolved from whatever index the model referenced them by. */
  citedSourceIds: string[];
}

export interface GenerateDeps {
  getOutline(requestId: string): Promise<{ planId: string; outline: Outline }>;
  getRankedSources(requestId: string): Promise<RankedSourceForPlanning[]>;
  /** 1 on the first attempt for this request; increments each time generate re-runs after a revise verdict. */
  getNextVersion(requestId: string): Promise<number>;
  /** Feedback from the most recent article evaluation, if this is a revision (not the first attempt). */
  getRevisionFeedback(requestId: string): Promise<RevisionFeedback | null>;
  generateOptions(
    outline: Outline,
    sources: RankedSourceForPlanning[],
    feedback: RevisionFeedback | null,
    numOptions: number,
    wordRange: { min: number; max: number },
  ): Promise<{ options: DraftOption[]; tokensUsed: number }>;
  storeDrafts(requestId: string, planId: string, version: number, options: DraftOption[]): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Generate stage: fill the outline into a full article draft with
 * citations back to the ranked sources. Re-entered by evaluate_article on
 * a "revise" verdict (see NEXT_STAGE override there), in which case the
 * prior evaluation's feedback is folded into the prompt.
 */
export async function runGenerate(job: PipelineJob, deps: GenerateDeps): Promise<StageResult> {
  const { planId, outline } = await deps.getOutline(job.request_id);
  const sources = await deps.getRankedSources(job.request_id);
  const version = await deps.getNextVersion(job.request_id);
  const feedback = version > 1 ? await deps.getRevisionFeedback(job.request_id) : null;

  const { options, tokensUsed } = await deps.generateOptions(
    outline,
    sources,
    feedback,
    NUM_DRAFT_OPTIONS,
    TARGET_WORD_RANGE,
  );
  await deps.storeDrafts(job.request_id, planId, version, options);

  await deps.logActivity(job.request_id, "draft_generated", {
    version,
    optionCount: options.length,
    isRevision: feedback !== null,
  });

  return { nextAction: "advance", tokensUsed };
}

registerStage("generate", (job) => runGenerate(job, createGenerateDeps()));
