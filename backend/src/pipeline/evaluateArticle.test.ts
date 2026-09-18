import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runEvaluateArticle,
  type EvaluateArticleDeps,
  type DraftEvaluation,
  type DraftForEvaluation,
} from "./evaluateArticle.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "evaluate_article",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeEval(overrides: Partial<DraftEvaluation> = {}): DraftEvaluation {
  return {
    optionNumber: 1,
    detail: { scores: { topic_relevance: 3 } as never, weak_claims: [], sections_needing_revision: [] },
    overallStatus: "revise",
    notes: "",
    ...overrides,
  };
}

function makeHarness(opts: {
  version: number;
  drafts: DraftForEvaluation[];
  evaluations: DraftEvaluation[];
}) {
  const storeCalls: { version: number; evaluations: DraftEvaluation[] }[] = [];
  const activityCalls: { action: string; detail?: Record<string, unknown> }[] = [];

  const deps: EvaluateArticleDeps = {
    async getBrief() {
      return { topic: "T", overview: "..." };
    },
    async getLatestDrafts() {
      return { version: opts.version, drafts: opts.drafts };
    },
    async evaluateDrafts() {
      return { evaluations: opts.evaluations, tokensUsed: 55 };
    },
    async storeEvaluations(_requestId, version, _drafts, evaluations) {
      storeCalls.push({ version, evaluations });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, storeCalls, activityCalls };
}

const draftOne: DraftForEvaluation = { id: "d1", optionNumber: 1, bodyMarkdown: "body 1" };
const draftTwo: DraftForEvaluation = { id: "d2", optionNumber: 2, bodyMarkdown: "body 2" };

test("a passing draft advances to channel_adapt with no manual-attention flag", async () => {
  const h = makeHarness({
    version: 1,
    drafts: [draftOne],
    evaluations: [makeEval({ optionNumber: 1, overallStatus: "pass" })],
  });

  const result = await runEvaluateArticle(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(result.nextStage, "channel_adapt");
  assert.equal(h.activityCalls[0]?.detail?.needsManualAttention, false);
});

test("a revise verdict below the iteration cap routes back to generate", async () => {
  const h = makeHarness({
    version: 1,
    drafts: [draftOne],
    evaluations: [makeEval({ optionNumber: 1, overallStatus: "revise" })],
  });

  const result = await runEvaluateArticle(makeJob(), h.deps);

  assert.equal(result.nextStage, "generate");
  assert.equal(h.activityCalls[0]?.detail?.needsManualAttention, false);
});

test("a revise verdict at the iteration cap is forced through to channel_adapt, flagged", async () => {
  const h = makeHarness({
    version: 3,
    drafts: [draftOne],
    evaluations: [makeEval({ optionNumber: 1, overallStatus: "revise" })],
  });

  const result = await runEvaluateArticle(makeJob(), h.deps);

  assert.equal(result.nextStage, "channel_adapt");
  assert.equal(h.activityCalls[0]?.detail?.needsManualAttention, true);
});

test("a passing option is preferred over a higher-scoring revise option", async () => {
  const h = makeHarness({
    version: 1,
    drafts: [draftOne, draftTwo],
    evaluations: [
      makeEval({
        optionNumber: 1,
        overallStatus: "revise",
        detail: { scores: { topic_relevance: 5 } as never, weak_claims: [], sections_needing_revision: [] },
      }),
      makeEval({
        optionNumber: 2,
        overallStatus: "pass",
        detail: { scores: { topic_relevance: 2 } as never, weak_claims: [], sections_needing_revision: [] },
      }),
    ],
  });

  const result = await runEvaluateArticle(makeJob(), h.deps);

  assert.equal(result.nextStage, "channel_adapt");
  assert.equal(h.activityCalls[0]?.detail?.bestOptionNumber, 2);
});

test("among two revise options, the higher-scoring one is picked as best", async () => {
  const h = makeHarness({
    version: 1,
    drafts: [draftOne, draftTwo],
    evaluations: [
      makeEval({
        optionNumber: 1,
        overallStatus: "revise",
        detail: { scores: { topic_relevance: 2 } as never, weak_claims: [], sections_needing_revision: [] },
      }),
      makeEval({
        optionNumber: 2,
        overallStatus: "revise",
        detail: { scores: { topic_relevance: 4 } as never, weak_claims: [], sections_needing_revision: [] },
      }),
    ],
  });

  const result = await runEvaluateArticle(makeJob(), h.deps);

  assert.equal(h.activityCalls[0]?.detail?.bestOptionNumber, 2);
  assert.equal(result.nextStage, "generate");
});

test("no drafts found is a hard error, not a silent no-op", async () => {
  const h = makeHarness({ version: 1, drafts: [], evaluations: [] });
  await assert.rejects(() => runEvaluateArticle(makeJob(), h.deps));
});
