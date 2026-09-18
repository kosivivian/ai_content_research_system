import { test } from "node:test";
import assert from "node:assert/strict";
import { runRegenerateArticle, type RegenerateArticleDeps } from "./regenerateArticle.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(payload: Record<string, unknown>): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "regenerate_article",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<RegenerateArticleDeps> = {}) {
  const calls: { updateArticleBody: unknown[][]; logActivity: unknown[][]; regenerateBody: unknown[][] } = {
    updateArticleBody: [],
    logActivity: [],
    regenerateBody: [],
  };

  const deps: RegenerateArticleDeps = {
    async getBrief() {
      return { topic: "T", audience: "devs" };
    },
    async getRankedSources() {
      return [{ id: "s1", sourceUrl: "https://a.example", excerpt: "..." }];
    },
    async getArticleBody() {
      return "old body";
    },
    async regenerateBody(currentBody, brief, sources, instructions) {
      calls.regenerateBody.push([currentBody, brief, sources, instructions]);
      return { body: "new body", tokensUsed: 100 };
    },
    async updateArticleBody(articleDraftId, body) {
      calls.updateArticleBody.push([articleDraftId, body]);
    },
    async logActivity(requestId, action, detail) {
      calls.logActivity.push([requestId, action, detail]);
    },
    ...overrides,
  };

  return { deps, calls };
}

test("regenerates the article in place and logs the action", async () => {
  const { deps, calls } = makeDeps();
  const job = makeJob({ articleDraftId: "d1", instructions: "make it punchier" });

  const result = await runRegenerateArticle(job, deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(result.tokensUsed, 100);
  assert.deepEqual(calls.updateArticleBody[0], ["d1", "new body"]);
  assert.deepEqual(calls.logActivity[0], [
    "req-1",
    "article_regenerated",
    { articleDraftId: "d1", instructions: "make it punchier" },
  ]);
});

test("instructions are optional -- passed through as undefined, logged as null", async () => {
  const { deps, calls } = makeDeps();
  const job = makeJob({ articleDraftId: "d1" });

  await runRegenerateArticle(job, deps);

  assert.equal((calls.regenerateBody[0] as unknown[])[3], undefined);
  const detail = calls.logActivity[0]![2] as Record<string, unknown>;
  assert.equal(detail.instructions, null);
});

test("a payload missing articleDraftId is a hard error, not a silent no-op", async () => {
  const { deps } = makeDeps();
  const job = makeJob({});
  await assert.rejects(() => runRegenerateArticle(job, deps), /articleDraftId/);
});
