import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runChannelAdapt,
  type ChannelAdaptDeps,
  type ChannelDraftContent,
  type ChannelRevisionFeedback,
} from "./channelAdapt.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "channel_adapt",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeHarness(opts: { version: number; feedback: ChannelRevisionFeedback[]; drafts: ChannelDraftContent[] }) {
  const storeCalls: { articleDraftId: string; version: number; drafts: ChannelDraftContent[] }[] = [];
  const activityCalls: { action: string; detail?: Record<string, unknown> }[] = [];
  let feedbackCallCount = 0;

  const deps: ChannelAdaptDeps = {
    async getBrief() {
      return { topic: "T", audience: "devs", overview: "..." };
    },
    async getWinningArticle() {
      return { draftId: "article-1", bodyMarkdown: "the article" };
    },
    async getNextVersion() {
      return opts.version;
    },
    async getRevisionFeedback() {
      feedbackCallCount++;
      return opts.feedback;
    },
    async generateChannelDrafts() {
      return { drafts: opts.drafts, tokensUsed: 300 };
    },
    async storeChannelDrafts(_requestId, articleDraftId, version, drafts) {
      storeCalls.push({ articleDraftId, version, drafts });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, storeCalls, activityCalls, feedbackCallCount: () => feedbackCallCount };
}

const allThree: ChannelDraftContent[] = [
  { channel: "linkedin", body: "li" },
  { channel: "x", body: "x" },
  { channel: "email", body: "Subject: s\n\nbody" },
];

test("first attempt never fetches revision feedback and stores all three channels", async () => {
  const h = makeHarness({ version: 1, feedback: [], drafts: allThree });

  const result = await runChannelAdapt(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(h.feedbackCallCount(), 0);
  assert.equal(h.storeCalls[0]?.articleDraftId, "article-1");
  assert.equal(h.storeCalls[0]?.drafts.length, 3);
  assert.equal(h.activityCalls[0]?.detail?.isRevision, false);
});

test("a later version fetches and forwards per-channel revision feedback", async () => {
  const feedback: ChannelRevisionFeedback[] = [{ channel: "linkedin", notes: "too long" }];
  const h = makeHarness({ version: 2, feedback, drafts: allThree });

  await runChannelAdapt(makeJob(), h.deps);

  assert.equal(h.feedbackCallCount(), 1);
  assert.equal(h.activityCalls[0]?.detail?.isRevision, true);
  assert.equal(h.storeCalls[0]?.version, 2);
});
