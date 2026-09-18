import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlan, type PlanDeps, type Outline, type RankedSourceForPlanning } from "./plan.js";
import type { PipelineJob, Brief } from "../types/db.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "plan",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeOutline(overrides: Partial<Outline> = {}): Outline {
  return {
    title: "Why Async Standups Work",
    primary_keyword: "async standups",
    secondary_keywords: ["remote teams", "engineering managers"],
    hook: "Meetings are expensive.",
    sections: [{ heading: "The Problem", level: "h2", key_points: ["Standups eat time"] }],
    cta: "Try it with your team this week.",
    ...overrides,
  };
}

function makeHarness(opts: { brief?: Brief; sources?: RankedSourceForPlanning[]; outline: Outline }) {
  const storeCalls: { requestId: string; outline: Outline }[] = [];
  const activityCalls: { action: string; detail?: Record<string, unknown> }[] = [];
  const generateOutlineCalls: { brief: Brief; sources: RankedSourceForPlanning[] }[] = [];

  const deps: PlanDeps = {
    async getBrief() {
      return opts.brief ?? { topic: "Async standups", audience: "engineering managers", overview: "..." };
    },
    async getRankedSources() {
      return opts.sources ?? [];
    },
    async generateOutline(brief, sources) {
      generateOutlineCalls.push({ brief, sources });
      return { outline: opts.outline, tokensUsed: 88 };
    },
    async storeOutline(requestId, outline) {
      storeCalls.push({ requestId, outline });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, storeCalls, activityCalls, generateOutlineCalls };
}

test("stores the generated outline and advances", async () => {
  const outline = makeOutline();
  const h = makeHarness({ outline });

  const result = await runPlan(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(result.tokensUsed, 88);
  assert.deepEqual(h.storeCalls[0]?.outline, outline);
  assert.equal(h.activityCalls[0]?.detail?.sectionCount, 1);
});

test("passes the ranked sources through to outline generation", async () => {
  const sources: RankedSourceForPlanning[] = [{ id: "s1", sourceUrl: "https://a.example", excerpt: "..." }];
  const h = makeHarness({ sources, outline: makeOutline() });

  await runPlan(makeJob(), h.deps);

  assert.equal(h.generateOutlineCalls[0]?.sources.length, 1);
  assert.equal(h.generateOutlineCalls[0]?.sources[0]?.id, "s1");
});
