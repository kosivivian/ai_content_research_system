import { test } from "node:test";
import assert from "node:assert/strict";
import { runRerank, type RerankDeps, type Candidate, type RankedSource } from "./rerank.js";
import type { PipelineJob, Brief } from "../types/db.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "rerank",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeHarness(opts: {
  brief?: Brief;
  candidates: Candidate[];
  ranked: RankedSource[];
}) {
  const replaceCalls: { requestId: string; ranked: RankedSource[] }[] = [];
  const activityCalls: { action: string; detail?: Record<string, unknown> }[] = [];
  const rankCandidatesCalls: Candidate[][] = [];

  const deps: RerankDeps = {
    async getBrief() {
      return opts.brief ?? { topic: "Async standups", overview: "..." };
    },
    async embedQuery() {
      return [0.1, 0.2, 0.3];
    },
    async getCandidates() {
      return opts.candidates;
    },
    async rankCandidates(_brief, candidates) {
      rankCandidatesCalls.push(candidates);
      return { ranked: opts.ranked, tokensUsed: 77 };
    },
    async replaceRankedSources(requestId, ranked) {
      replaceCalls.push({ requestId, ranked });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, replaceCalls, activityCalls, rankCandidatesCalls };
}

test("ranks candidates and stores the result", async () => {
  const candidates: Candidate[] = [
    { id: "s1", sourceUrl: "https://a.example", extractedText: "a", distance: 0.1 },
    { id: "s2", sourceUrl: "https://b.example", extractedText: "b", distance: 0.4 },
  ];
  const ranked: RankedSource[] = [
    { sourceMaterialId: "s1", relevanceScore: 0.9, rank: 1 },
    { sourceMaterialId: "s2", relevanceScore: 0.6, rank: 2 },
  ];
  const h = makeHarness({ candidates, ranked });

  const result = await runRerank(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(result.tokensUsed, 77);
  assert.deepEqual(h.replaceCalls[0]?.ranked, ranked);
  assert.equal(h.activityCalls[0]?.detail?.candidates, 2);
  assert.equal(h.activityCalls[0]?.detail?.selected, 2);
});

test("no candidates is a no-op that still advances without calling the model", async () => {
  const h = makeHarness({ candidates: [], ranked: [] });

  const result = await runRerank(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(h.rankCandidatesCalls.length, 0);
  assert.equal(h.activityCalls[0]?.detail?.selected, 0);
});
