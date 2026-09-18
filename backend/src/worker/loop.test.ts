import { test } from "node:test";
import assert from "node:assert/strict";
import { runOneTick, type WorkerDeps } from "./loop.js";
import { registerStage } from "./registry.js";
import type { PipelineJob } from "../types/db.js";

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "intake",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface Calls {
  claimNextJob: unknown[][];
  markJobDone: unknown[][];
  markJobFailed: unknown[][];
  requeueJob: unknown[][];
  advanceJob: unknown[][];
  setRequestStatus: unknown[][];
  logActivity: unknown[][];
  logError: unknown[][];
  notifyApproverOfError: unknown[][];
}

function makeDeps(overrides: Partial<WorkerDeps> = {}, job: PipelineJob | null): {
  deps: WorkerDeps;
  calls: Calls;
} {
  const calls: Calls = {
    claimNextJob: [],
    markJobDone: [],
    markJobFailed: [],
    requeueJob: [],
    advanceJob: [],
    setRequestStatus: [],
    logActivity: [],
    logError: [],
    notifyApproverOfError: [],
  };

  const deps: WorkerDeps = {
    maxAttempts: 3,
    async claimNextJob() {
      calls.claimNextJob.push([]);
      return job;
    },
    async markJobDone(jobId) {
      calls.markJobDone.push([jobId]);
    },
    async markJobFailed(jobId) {
      calls.markJobFailed.push([jobId]);
    },
    async requeueJob(jobId) {
      calls.requeueJob.push([jobId]);
    },
    async advanceJob(j, next) {
      calls.advanceJob.push([j.id, next]);
    },
    async setRequestStatus(requestId, status) {
      calls.setRequestStatus.push([requestId, status]);
    },
    async logActivity(requestId, action, detail) {
      calls.logActivity.push([requestId, action, detail]);
    },
    async logError(requestId, stage, detail) {
      calls.logError.push([requestId, stage, detail]);
    },
    async notifyApproverOfError(requestId, stage, detail) {
      calls.notifyApproverOfError.push([requestId, stage, detail]);
    },
    ...overrides,
  };

  return { deps, calls };
}

test("returns idle and touches nothing else when no job is queued", async () => {
  const { deps, calls } = makeDeps({}, null);
  const result = await runOneTick(deps);
  assert.equal(result, "idle");
  assert.equal(calls.markJobDone.length, 0);
  assert.equal(calls.logError.length, 0);
});

test("unknown stage fails the job without invoking any handler or touching status", async () => {
  const job = makeJob({ stage: "not-a-real-stage" });
  const { deps, calls } = makeDeps({}, job);
  const result = await runOneTick(deps);
  assert.equal(result, "processed");
  assert.equal(calls.markJobFailed.length, 1);
  assert.equal(calls.logError.length, 1);
  assert.equal(calls.setRequestStatus.length, 0);
});

test("advance moves to the next stage, logs activity, and reflects progress on status", async () => {
  registerStage("intake", async () => ({ nextAction: "advance", tokensUsed: 42 }));
  const job = makeJob({ stage: "intake" });
  const { deps, calls } = makeDeps({}, job);

  const result = await runOneTick(deps);

  assert.equal(result, "processed");
  assert.deepEqual(calls.advanceJob[0], ["job-1", "research"]);
  assert.equal(calls.markJobDone.length, 0);
  assert.equal((calls.logActivity[0] as unknown[])[1], "stage_completed:intake");
  assert.deepEqual(calls.setRequestStatus[0], ["req-1", "intake"]);
});

test("a research-stage job sets status to 'researching' before the handler runs", async () => {
  registerStage("research", async () => ({ nextAction: "advance" }));
  const job = makeJob({ stage: "research" });
  const { deps, calls } = makeDeps({}, job);

  await runOneTick(deps);

  assert.deepEqual(calls.setRequestStatus[0], ["req-1", "researching"]);
});

test("a regenerate_article job never touches content_requests.status (no STAGE_STATUS entry)", async () => {
  registerStage("regenerate_article", async () => ({ nextAction: "advance" }));
  const job = makeJob({ stage: "regenerate_article" });
  const { deps, calls } = makeDeps({}, job);

  await runOneTick(deps);

  assert.equal(calls.setRequestStatus.length, 0);
});

test("an explicit nextStage overrides the static NEXT_STAGE chain", async () => {
  registerStage("evaluate_article", async () => ({ nextAction: "advance", nextStage: "generate" }));
  const job = makeJob({ stage: "evaluate_article" });
  const { deps, calls } = makeDeps({}, job);

  await runOneTick(deps);

  assert.deepEqual(calls.advanceJob[0], ["job-1", "generate"]);
});

test("requeue_self sends the job back to queued on the same stage", async () => {
  registerStage("evaluate_article", async () => ({ nextAction: "requeue_self" }));
  const job = makeJob({ stage: "evaluate_article" });
  const { deps, calls } = makeDeps({}, job);

  await runOneTick(deps);

  assert.deepEqual(calls.requeueJob[0], ["job-1"]);
  assert.equal(calls.advanceJob.length, 0);
  assert.equal(calls.markJobDone.length, 0);
});

test("a terminal stage (no successor) marks the job done instead of advancing", async () => {
  registerStage("evaluate_channel", async () => ({ nextAction: "advance" }));
  const job = makeJob({ stage: "evaluate_channel" });
  const { deps, calls } = makeDeps({}, job);

  await runOneTick(deps);

  assert.deepEqual(calls.markJobDone, [["job-1"]]);
  assert.equal(calls.advanceJob.length, 0);
});

test("a failure below maxAttempts requeues instead of failing the job", async () => {
  registerStage("plan", async () => {
    throw new Error("boom");
  });
  const job = makeJob({ stage: "plan", attempt_count: 2 });
  const { deps, calls } = makeDeps({ maxAttempts: 3 }, job);

  await runOneTick(deps);

  assert.equal(calls.logError.length, 1);
  assert.deepEqual(calls.requeueJob, [["job-1"]]);
  assert.equal(calls.markJobFailed.length, 0);
  assert.equal(calls.notifyApproverOfError.length, 0);
});

test("a failure at or past maxAttempts fails the job and notifies the approver", async () => {
  registerStage("plan", async () => {
    throw new Error("boom again");
  });
  const job = makeJob({ stage: "plan", attempt_count: 3 });
  const { deps, calls } = makeDeps({ maxAttempts: 3 }, job);

  await runOneTick(deps);

  assert.equal(calls.requeueJob.length, 0);
  assert.deepEqual(calls.markJobFailed, [["job-1"]]);
  assert.equal(calls.notifyApproverOfError.length, 1);
  assert.deepEqual(calls.setRequestStatus.at(-1), ["req-1", "errored"]);
});
