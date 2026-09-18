import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runEvaluateChannel,
  type EvaluateChannelDeps,
  type ChannelDraftForEvaluation,
  type ChannelEvaluation,
} from "./evaluateChannel.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "evaluate_channel",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeEval(overrides: Partial<ChannelEvaluation> = {}): ChannelEvaluation {
  return {
    channel: "linkedin",
    detail: { scores: { channel_fit: 4 }, weak_claims: [], sections_needing_revision: [] },
    overallStatus: "pass",
    notes: "",
    ...overrides,
  };
}

const drafts: ChannelDraftForEvaluation[] = [
  { id: "d-li", channel: "linkedin", body: "li" },
  { id: "d-x", channel: "x", body: "x" },
  { id: "d-email", channel: "email", body: "Subject: s\n\nbody" },
];

function makeHarness(opts: { version: number; evaluations: ChannelEvaluation[] }) {
  const markCalls: { needsManualAttention: boolean }[] = [];
  const activityCalls: { action: string; detail?: Record<string, unknown> }[] = [];

  const deps: EvaluateChannelDeps = {
    async getBrief() {
      return { topic: "T", overview: "..." };
    },
    async getLatestChannelDrafts() {
      return { version: opts.version, drafts };
    },
    async evaluateChannelDrafts() {
      return { evaluations: opts.evaluations, tokensUsed: 40 };
    },
    async storeEvaluations() {},
    async markAwaitingCreator(_requestId, needsManualAttention) {
      markCalls.push({ needsManualAttention });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, markCalls, activityCalls };
}

test("all channels passing hands the request back to the creator, not flagged", async () => {
  const h = makeHarness({
    version: 1,
    evaluations: [
      makeEval({ channel: "linkedin" }),
      makeEval({ channel: "x" }),
      makeEval({ channel: "email" }),
    ],
  });

  const result = await runEvaluateChannel(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(result.nextStage, undefined);
  assert.deepEqual(h.markCalls, [{ needsManualAttention: false }]);
});

test("one channel failing below the cap sends the whole batch back to channel_adapt", async () => {
  const h = makeHarness({
    version: 1,
    evaluations: [
      makeEval({ channel: "linkedin", overallStatus: "revise" }),
      makeEval({ channel: "x" }),
      makeEval({ channel: "email" }),
    ],
  });

  const result = await runEvaluateChannel(makeJob(), h.deps);

  assert.equal(result.nextStage, "channel_adapt");
  assert.equal(h.markCalls.length, 0);
});

test("a failure at the iteration cap still hands back to the creator, flagged", async () => {
  const h = makeHarness({
    version: 3,
    evaluations: [
      makeEval({ channel: "linkedin", overallStatus: "revise" }),
      makeEval({ channel: "x" }),
      makeEval({ channel: "email" }),
    ],
  });

  const result = await runEvaluateChannel(makeJob(), h.deps);

  assert.equal(result.nextStage, undefined);
  assert.deepEqual(h.markCalls, [{ needsManualAttention: true }]);
});

test("no channel drafts found is a hard error", async () => {
  const deps: EvaluateChannelDeps = {
    async getBrief() {
      return {};
    },
    async getLatestChannelDrafts() {
      return { version: 0, drafts: [] };
    },
    async evaluateChannelDrafts() {
      return { evaluations: [], tokensUsed: 0 };
    },
    async storeEvaluations() {},
    async markAwaitingCreator() {},
    async logActivity() {},
  };

  await assert.rejects(() => runEvaluateChannel(makeJob(), deps));
});
