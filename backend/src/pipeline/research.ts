import type { PipelineJob, Brief } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createResearchDeps } from "./researchDeps.js";

export interface SearchHit {
  url: string;
  title: string;
  content: string;
  score: number;
  query: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** "none" means every tool (Tavily, then the Claude web-search fallback) failed for this query. */
  toolUsed: "tavily" | "claude_web_search" | "none";
}

export interface ResearchDeps {
  getBrief(requestId: string): Promise<Brief>;
  generateQueries(brief: Brief): Promise<{ queries: string[]; tokensUsed: number }>;
  /** Never throws -- degrades to toolUsed: "none" with empty hits if every option fails. */
  searchWithFallback(query: string): Promise<SearchOutcome>;
  logResearchQuery(requestId: string, queryText: string, toolUsed: string, resultCount: number): Promise<void>;
  replaceResearchSources(requestId: string, hits: SearchHit[]): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Research stage: turn the brief into a batch of search queries, run them
 * (with fallback/degradation baked in), and land deduped results as
 * source_materials for the retrieve stage to embed.
 */
export async function runResearch(job: PipelineJob, deps: ResearchDeps): Promise<StageResult> {
  const brief = await deps.getBrief(job.request_id);
  const { queries, tokensUsed } = await deps.generateQueries(brief);

  const allHits: SearchHit[] = [];
  let anyDegraded = false;

  for (const query of queries) {
    const outcome = await deps.searchWithFallback(query);
    await deps.logResearchQuery(job.request_id, query, outcome.toolUsed, outcome.hits.length);
    if (outcome.toolUsed === "none") anyDegraded = true;
    allHits.push(...outcome.hits);
  }

  const deduped = dedupeByUrl(allHits);
  await deps.replaceResearchSources(job.request_id, deduped);

  await deps.logActivity(job.request_id, "research_completed", {
    queriesGenerated: queries.length,
    sourcesFound: deduped.length,
    degraded: anyDegraded || deduped.length === 0,
  });

  return { nextAction: "advance", tokensUsed };
}

function dedupeByUrl(hits: SearchHit[]): SearchHit[] {
  const byUrl = new Map<string, SearchHit>();
  for (const hit of hits) {
    const existing = byUrl.get(hit.url);
    if (!existing || hit.score > existing.score) byUrl.set(hit.url, hit);
  }
  return [...byUrl.values()];
}

registerStage("research", (job) => runResearch(job, createResearchDeps()));
