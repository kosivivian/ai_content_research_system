import { test } from "node:test";
import assert from "node:assert/strict";
import { runRetrieve, type RetrieveDeps, type UnembeddedSource } from "./retrieve.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "retrieve",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeHarness(sources: UnembeddedSource[]) {
  const stored: { id: string; embedding: number[] }[] = [];
  const embedCalls: string[][] = [];

  const deps: RetrieveDeps = {
    async getUnembeddedSources() {
      return sources;
    },
    async embedBatch(texts) {
      embedCalls.push(texts);
      return texts.map((_, i) => [i, i + 1, i + 2]);
    },
    async storeEmbeddings(items) {
      stored.push(...items);
    },
    async logActivity() {},
  };

  return { deps, stored, embedCalls };
}

test("embeds every unembedded source and stores the resulting vectors", async () => {
  const { deps, stored } = makeHarness([
    { id: "s1", extractedText: "text one" },
    { id: "s2", extractedText: "text two" },
  ]);

  const result = await runRetrieve(makeJob(), deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], { id: "s1", embedding: [0, 1, 2] });
  assert.deepEqual(stored[1], { id: "s2", embedding: [1, 2, 3] });
});

test("no unembedded sources is a no-op that still advances", async () => {
  const { deps, stored } = makeHarness([]);
  const result = await runRetrieve(makeJob(), deps);
  assert.equal(result.nextAction, "advance");
  assert.equal(stored.length, 0);
});

test("batches large source counts instead of embedding everything in one call", async () => {
  const sources = Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, extractedText: `text ${i}` }));
  const { deps, stored, embedCalls } = makeHarness(sources);

  await runRetrieve(makeJob(), deps);

  assert.equal(stored.length, 120);
  assert.equal(embedCalls.length, 3); // 50 + 50 + 20
  assert.equal(embedCalls[0]?.length, 50);
  assert.equal(embedCalls[2]?.length, 20);
});

test("a batch/response length mismatch throws instead of silently mis-assigning vectors", async () => {
  const deps: RetrieveDeps = {
    async getUnembeddedSources() {
      return [
        { id: "s1", extractedText: "a" },
        { id: "s2", extractedText: "b" },
      ];
    },
    async embedBatch() {
      return [[1, 2, 3]]; // one vector for two inputs
    },
    async storeEmbeddings() {},
    async logActivity() {},
  };

  await assert.rejects(() => runRetrieve(makeJob(), deps));
});
