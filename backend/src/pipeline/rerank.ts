import type { PipelineJob, Brief } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createRerankDeps } from "./rerankDeps.js";

export interface Candidate {
  id: string;
  sourceUrl: string | null;
  extractedText: string;
  distance: number;
}

export interface RankedSource {
  sourceMaterialId: string;
  relevanceScore: number;
  rank: number;
}

const CANDIDATE_POOL_SIZE = 10;
const TOP_N = 5;

export interface RerankDeps {
  getBrief(requestId: string): Promise<Brief>;
  embedQuery(text: string): Promise<number[]>;
  getCandidates(requestId: string, queryEmbedding: number[], limit: number): Promise<Candidate[]>;
  rankCandidates(
    brief: Brief,
    candidates: Candidate[],
    topN: number,
  ): Promise<{ ranked: RankedSource[]; tokensUsed: number }>;
  replaceRankedSources(requestId: string, ranked: RankedSource[]): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Rerank stage: vector-prefilter candidate sources against the brief, then
 * have the model pick and order the top few -- keeps what actually reaches
 * the generation stage's context small, avoiding lost-in-the-middle.
 */
export async function runRerank(job: PipelineJob, deps: RerankDeps): Promise<StageResult> {
  const brief = await deps.getBrief(job.request_id);
  const queryEmbedding = await deps.embedQuery(`${brief.topic ?? ""}\n${brief.overview ?? ""}`);
  const candidates = await deps.getCandidates(job.request_id, queryEmbedding, CANDIDATE_POOL_SIZE);

  if (candidates.length === 0) {
    await deps.logActivity(job.request_id, "sources_reranked", { candidates: 0, selected: 0 });
    return { nextAction: "advance", tokensUsed: 0 };
  }

  const { ranked, tokensUsed } = await deps.rankCandidates(brief, candidates, TOP_N);
  await deps.replaceRankedSources(job.request_id, ranked);

  await deps.logActivity(job.request_id, "sources_reranked", {
    candidates: candidates.length,
    selected: ranked.length,
  });

  return { nextAction: "advance", tokensUsed };
}

registerStage("rerank", (job) => runRerank(job, createRerankDeps()));
