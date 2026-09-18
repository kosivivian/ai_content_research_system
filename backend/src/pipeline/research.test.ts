import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearch, type ResearchDeps, type SearchHit, type SearchOutcome } from "./research.js";
import type { PipelineJob, Brief } from "../types/db.js";

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "research",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface Harness {
  deps: ResearchDeps;
  replaceCalls: { requestId: string; hits: SearchHit[] }[];
  queryLogCalls: { toolUsed: string; resultCount: number }[];
  activityCalls: { action: string; detail?: Record<string, unknown> }[];
}

function makeHarness(opts: {
  brief?: Brief;
  queries: string[];
  outcomesByQuery: Record<string, SearchOutcome>;
}): Harness {
  const replaceCalls: Harness["replaceCalls"] = [];
  const queryLogCalls: Harness["queryLogCalls"] = [];
  const activityCalls: Harness["activityCalls"] = [];

  const deps: ResearchDeps = {
    async getBrief() {
      return opts.brief ?? { topic: "Async standups", audience: "engineering managers", overview: "..." };
    },
    async generateQueries() {
      return { queries: opts.queries, tokensUsed: 50 };
    },
    async searchWithFallback(query) {
      return opts.outcomesByQuery[query] ?? { hits: [], toolUsed: "none" };
    },
    async logResearchQuery(_requestId, _queryText, toolUsed, resultCount) {
      queryLogCalls.push({ toolUsed, resultCount });
    },
    async replaceResearchSources(requestId, hits) {
      replaceCalls.push({ requestId, hits });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, replaceCalls, queryLogCalls, activityCalls };
}

test("happy path: all queries succeed, sources deduped and stored, not degraded", async () => {
  const h = makeHarness({
    queries: ["q1", "q2"],
    outcomesByQuery: {
      q1: {
        toolUsed: "tavily",
        hits: [{ url: "https://a.example", title: "A", content: "text a", score: 0.9, query: "q1" }],
      },
      q2: {
        toolUsed: "tavily",
        hits: [{ url: "https://b.example", title: "B", content: "text b", score: 0.8, query: "q2" }],
      },
    },
  });

  const result = await runResearch(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(h.replaceCalls[0]?.hits.length, 2);
  assert.equal(h.activityCalls[0]?.detail?.degraded, false);
});

test("a duplicate URL across queries keeps only the higher-scoring hit", async () => {
  const h = makeHarness({
    queries: ["q1", "q2"],
    outcomesByQuery: {
      q1: {
        toolUsed: "tavily",
        hits: [{ url: "https://a.example", title: "A", content: "low score version", score: 0.4, query: "q1" }],
      },
      q2: {
        toolUsed: "tavily",
        hits: [{ url: "https://a.example", title: "A", content: "high score version", score: 0.95, query: "q2" }],
      },
    },
  });

  await runResearch(makeJob(), h.deps);

  assert.equal(h.replaceCalls[0]?.hits.length, 1);
  assert.equal(h.replaceCalls[0]?.hits[0]?.content, "high score version");
});

test("a query that exhausts every fallback marks the request degraded but still advances", async () => {
  const h = makeHarness({
    queries: ["q1", "q2"],
    outcomesByQuery: {
      q1: {
        toolUsed: "tavily",
        hits: [{ url: "https://a.example", title: "A", content: "text a", score: 0.9, query: "q1" }],
      },
      q2: { toolUsed: "none", hits: [] },
    },
  });

  const result = await runResearch(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(h.activityCalls[0]?.detail?.degraded, true);
  assert.equal(h.queryLogCalls.some((c) => c.toolUsed === "none"), true);
});

test("zero sources found across all queries is still reported as degraded", async () => {
  const h = makeHarness({
    queries: ["q1"],
    outcomesByQuery: { q1: { toolUsed: "tavily", hits: [] } },
  });

  await runResearch(makeJob(), h.deps);

  assert.equal(h.activityCalls[0]?.detail?.degraded, true);
});
