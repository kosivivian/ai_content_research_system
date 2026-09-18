import { test } from "node:test";
import assert from "node:assert/strict";
import { runGenerate, type GenerateDeps, type DraftOption, type RevisionFeedback } from "./generate.js";
import type { PipelineJob } from "../types/db.js";
import type { Outline } from "./plan.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "generate",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const outline: Outline = {
  title: "T",
  primary_keyword: "kw",
  secondary_keywords: [],
  hook: "h",
  sections: [{ heading: "S", level: "h2", key_points: ["p"] }],
  cta: "cta",
};

function makeHarness(opts: {
  version: number;
  feedback: RevisionFeedback | null;
  options: DraftOption[];
}) {
  const storeCalls: { requestId: string; planId: string; version: number; options: DraftOption[] }[] = [];
  const activityCalls: { action: string; detail?: Record<string, unknown> }[] = [];
  const generateOptionsCalls: { feedback: RevisionFeedback | null }[] = [];
  let getRevisionFeedbackCallCount = 0;

  const deps: GenerateDeps = {
    async getOutline() {
      return { planId: "plan-1", outline };
    },
    async getRankedSources() {
      return [{ id: "s1", sourceUrl: "https://a.example", excerpt: "..." }];
    },
    async getNextVersion() {
      return opts.version;
    },
    async getRevisionFeedback() {
      getRevisionFeedbackCallCount++;
      return opts.feedback;
    },
    async generateOptions(_outline, _sources, feedback) {
      generateOptionsCalls.push({ feedback });
      return { options: opts.options, tokensUsed: 200 };
    },
    async storeDrafts(requestId, planId, version, options) {
      storeCalls.push({ requestId, planId, version, options });
    },
    async logActivity(_requestId, action, detail) {
      activityCalls.push({ action, detail });
    },
  };

  return { deps, storeCalls, activityCalls, generateOptionsCalls, getRevisionFeedbackCallCount: () => getRevisionFeedbackCallCount };
}

test("first attempt (version 1) never fetches revision feedback", async () => {
  const h = makeHarness({
    version: 1,
    feedback: null,
    options: [{ optionNumber: 1, bodyMarkdown: "body", citedSourceIds: ["s1"] }],
  });

  const result = await runGenerate(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(h.getRevisionFeedbackCallCount(), 0);
  assert.equal(h.generateOptionsCalls[0]?.feedback, null);
  assert.equal(h.activityCalls[0]?.detail?.isRevision, false);
  assert.equal(h.storeCalls[0]?.version, 1);
});

test("a later version fetches and forwards revision feedback", async () => {
  const feedback: RevisionFeedback = {
    notes: "too vague",
    weakClaims: ["claim X"],
    sectionsNeedingRevision: ["Intro"],
  };
  const h = makeHarness({
    version: 2,
    feedback,
    options: [{ optionNumber: 1, bodyMarkdown: "body v2", citedSourceIds: [] }],
  });

  await runGenerate(makeJob(), h.deps);

  assert.equal(h.getRevisionFeedbackCallCount(), 1);
  assert.deepEqual(h.generateOptionsCalls[0]?.feedback, feedback);
  assert.equal(h.activityCalls[0]?.detail?.isRevision, true);
  assert.equal(h.storeCalls[0]?.version, 2);
});
