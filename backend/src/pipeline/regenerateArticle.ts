import type { PipelineJob, Brief } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import type { RankedSourceForPlanning } from "./plan.js";
import { createRegenerateArticleDeps } from "./regenerateArticleDeps.js";

export interface RegenerateArticlePayload {
  articleDraftId: string;
  /** Optional creator instruction for what to fix -- e.g. approver feedback pasted in. Absent means "use your own judgment." */
  instructions?: string;
}

export interface RegenerateArticleDeps {
  getBrief(requestId: string): Promise<Brief>;
  getRankedSources(requestId: string): Promise<RankedSourceForPlanning[]>;
  getArticleBody(articleDraftId: string): Promise<string>;
  regenerateBody(
    currentBody: string,
    brief: Brief,
    sources: RankedSourceForPlanning[],
    instructions: string | undefined,
  ): Promise<{ body: string; tokensUsed: number }>;
  updateArticleBody(articleDraftId: string, body: string): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

function parsePayload(job: PipelineJob): RegenerateArticlePayload {
  const payload = job.payload as Partial<RegenerateArticlePayload> | undefined;
  if (!payload?.articleDraftId) {
    throw new Error(`regenerate_article: job payload missing articleDraftId (request ${job.request_id})`);
  }
  return { articleDraftId: payload.articleDraftId, instructions: payload.instructions };
}

/**
 * Creator-triggered, one-shot: rewrites the article in place (no new
 * version, no evaluation cycle -- this is a manual "try again", not part
 * of the automated quality loop). Grounded the same way generate.ts is
 * (brief + ranked sources), just against the existing body instead of a
 * fresh outline.
 */
export async function runRegenerateArticle(job: PipelineJob, deps: RegenerateArticleDeps): Promise<StageResult> {
  const { articleDraftId, instructions } = parsePayload(job);

  const [brief, sources, currentBody] = await Promise.all([
    deps.getBrief(job.request_id),
    deps.getRankedSources(job.request_id),
    deps.getArticleBody(articleDraftId),
  ]);

  const { body, tokensUsed } = await deps.regenerateBody(currentBody, brief, sources, instructions);
  await deps.updateArticleBody(articleDraftId, body);

  await deps.logActivity(job.request_id, "article_regenerated", {
    articleDraftId,
    instructions: instructions ?? null,
  });

  return { nextAction: "advance", tokensUsed };
}

registerStage("regenerate_article", (job) => runRegenerateArticle(job, createRegenerateArticleDeps()));
