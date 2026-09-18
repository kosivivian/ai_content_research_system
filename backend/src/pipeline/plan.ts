import type { PipelineJob, Brief } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createPlanDeps } from "./planDeps.js";

export interface RankedSourceForPlanning {
  id: string;
  sourceUrl: string | null;
  excerpt: string;
}

export interface OutlineSection {
  heading: string;
  level: "h2" | "h3";
  key_points: string[];
}

export interface Outline {
  title: string;
  primary_keyword: string;
  secondary_keywords: string[];
  hook: string;
  sections: OutlineSection[];
  cta: string;
}

export interface PlanDeps {
  getBrief(requestId: string): Promise<Brief>;
  getRankedSources(requestId: string): Promise<RankedSourceForPlanning[]>;
  generateOutline(
    brief: Brief,
    sources: RankedSourceForPlanning[],
  ): Promise<{ outline: Outline; tokensUsed: number }>;
  storeOutline(requestId: string, outline: Outline): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Plan stage: turn the brief + top-ranked sources into a structural outline
 * (title/hook/sections/CTA, primary + secondary keywords) that the generate
 * stage fills in. Applies the SEO structural rules (single H1 via the
 * title, H2/H3 sections, keyword placement) at the outline level so
 * generate doesn't have to reason about structure and content at once.
 */
export async function runPlan(job: PipelineJob, deps: PlanDeps): Promise<StageResult> {
  const brief = await deps.getBrief(job.request_id);
  const sources = await deps.getRankedSources(job.request_id);

  const { outline, tokensUsed } = await deps.generateOutline(brief, sources);
  await deps.storeOutline(job.request_id, outline);

  await deps.logActivity(job.request_id, "outline_planned", {
    title: outline.title,
    sectionCount: outline.sections.length,
  });

  return { nextAction: "advance", tokensUsed };
}

registerStage("plan", (job) => runPlan(job, createPlanDeps()));
