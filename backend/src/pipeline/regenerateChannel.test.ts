import { test } from "node:test";
import assert from "node:assert/strict";
import { runRegenerateChannel, type RegenerateChannelDeps } from "./regenerateChannel.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(payload: Record<string, unknown>): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "regenerate_channel",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<RegenerateChannelDeps> = {}) {
  const calls: { updateChannelBody: unknown[][]; logActivity: unknown[][]; regenerateBody: unknown[][] } = {
    updateChannelBody: [],
    logActivity: [],
    regenerateBody: [],
  };

  const deps: RegenerateChannelDeps = {
    async getBrief() {
      return { audience: "devs" };
    },
    async getChannelDraft() {
      return { channel: "linkedin", body: "old linkedin body", articleDraftId: "a1" };
    },
    async getArticleBody() {
      return "the article";
    },
    async regenerateBody(channel, currentBody, articleBody, brief, instructions) {
      calls.regenerateBody.push([channel, currentBody, articleBody, brief, instructions]);
      return { body: "new linkedin body", tokensUsed: 50 };
    },
    async updateChannelBody(channelDraftId, body) {
      calls.updateChannelBody.push([channelDraftId, body]);
    },
    async logActivity(requestId, action, detail) {
      calls.logActivity.push([requestId, action, detail]);
    },
    ...overrides,
  };

  return { deps, calls };
}

test("regenerates only the targeted channel, in place, and logs the action", async () => {
  const { deps, calls } = makeDeps();
  const job = makeJob({ channelDraftId: "c1", instructions: "shorter hook" });

  const result = await runRegenerateChannel(job, deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(result.tokensUsed, 50);
  assert.deepEqual(calls.updateChannelBody[0], ["c1", "new linkedin body"]);
  assert.deepEqual(calls.logActivity[0], [
    "req-1",
    "channel_draft_regenerated",
    { channelDraftId: "c1", channel: "linkedin", instructions: "shorter hook" },
  ]);
  // The regenerated channel is the only one touched -- no other channel is fetched or written.
  assert.equal(calls.regenerateBody[0]![0], "linkedin");
});

test("a payload missing channelDraftId is a hard error, not a silent no-op", async () => {
  const { deps } = makeDeps();
  const job = makeJob({});
  await assert.rejects(() => runRegenerateChannel(job, deps), /channelDraftId/);
});
