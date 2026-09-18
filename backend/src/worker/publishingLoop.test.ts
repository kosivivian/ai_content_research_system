import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnePublishTick, type PublishingDeps, type PublishingItem } from "./publishingLoop.js";

function makeItem(overrides: Partial<PublishingItem> = {}): PublishingItem {
  return {
    id: "item-1",
    request_id: "req-1",
    channel: "linkedin",
    scheduled_time: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Calls {
  claimNextItem: unknown[][];
  getChannelDraftBody: unknown[][];
  createBufferUpdate: unknown[][];
  markScheduled: unknown[][];
  markFailed: unknown[][];
  logActivity: unknown[][];
  logError: unknown[][];
  notifyApproverOfError: unknown[][];
}

function makeDeps(
  overrides: Partial<PublishingDeps> = {},
  item: PublishingItem | null,
): { deps: PublishingDeps; calls: Calls } {
  const calls: Calls = {
    claimNextItem: [],
    getChannelDraftBody: [],
    createBufferUpdate: [],
    markScheduled: [],
    markFailed: [],
    logActivity: [],
    logError: [],
    notifyApproverOfError: [],
  };

  const deps: PublishingDeps = {
    async claimNextItem() {
      calls.claimNextItem.push([]);
      return item;
    },
    async getChannelDraftBody(requestId, channel) {
      calls.getChannelDraftBody.push([requestId, channel]);
      return "draft body";
    },
    getBufferProfileId(channel) {
      return channel === "linkedin" ? "profile-linkedin" : "profile-x";
    },
    async createBufferUpdate(profileId, text, scheduledAt) {
      calls.createBufferUpdate.push([profileId, text, scheduledAt]);
      return { id: "buffer-update-1" };
    },
    async markScheduled(itemId, bufferPostId) {
      calls.markScheduled.push([itemId, bufferPostId]);
    },
    async markFailed(itemId) {
      calls.markFailed.push([itemId]);
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

test("returns idle and touches nothing when the queue is empty", async () => {
  const { deps, calls } = makeDeps({}, null);
  const result = await runOnePublishTick(deps);
  assert.equal(result, "idle");
  assert.equal(calls.markScheduled.length, 0);
  assert.equal(calls.markFailed.length, 0);
});

test("a linkedin item creates a Buffer update and marks scheduled", async () => {
  const item = makeItem({ channel: "linkedin" });
  const { deps, calls } = makeDeps({}, item);

  const result = await runOnePublishTick(deps);

  assert.equal(result, "processed");
  assert.deepEqual(calls.createBufferUpdate[0], ["profile-linkedin", "draft body", new Date(item.scheduled_time!)]);
  assert.deepEqual(calls.markScheduled, [["item-1", "buffer-update-1"]]);
  assert.equal(calls.markFailed.length, 0);
  assert.equal((calls.logActivity[0] as unknown[])[1], "publishing_scheduled");
});

test("a null scheduled_time is passed through as an immediate post", async () => {
  const item = makeItem({ channel: "x", scheduled_time: null });
  const { deps, calls } = makeDeps({}, item);

  await runOnePublishTick(deps);

  assert.deepEqual(calls.createBufferUpdate[0], ["profile-x", "draft body", null]);
});

test("a missing Buffer profile id fails the item and notifies the approver instead of throwing", async () => {
  const item = makeItem({ channel: "x" });
  const { deps, calls } = makeDeps({ getBufferProfileId: () => undefined }, item);

  const result = await runOnePublishTick(deps);

  assert.equal(result, "processed");
  assert.deepEqual(calls.markFailed, [["item-1"]]);
  assert.equal(calls.markScheduled.length, 0);
  assert.equal(calls.logError.length, 1);
  assert.equal(calls.notifyApproverOfError.length, 1);
});

test("a Buffer API failure fails the item, logs, and notifies the approver", async () => {
  const item = makeItem({ channel: "linkedin" });
  const { deps, calls } = makeDeps(
    {
      async createBufferUpdate() {
        throw new Error("Buffer is down");
      },
    },
    item,
  );

  await runOnePublishTick(deps);

  assert.deepEqual(calls.markFailed, [["item-1"]]);
  assert.equal(calls.markScheduled.length, 0);
  assert.equal((calls.logError[0] as unknown[])[1], "publish:linkedin");
  assert.equal(calls.notifyApproverOfError.length, 1);
});

test("an email item is never sent through Buffer -- it's failed with a loud error instead", async () => {
  const item = makeItem({ channel: "email" });
  const { deps, calls } = makeDeps({}, item);

  const result = await runOnePublishTick(deps);

  assert.equal(result, "processed");
  assert.deepEqual(calls.markFailed, [["item-1"]]);
  assert.equal(calls.createBufferUpdate.length, 0);
  assert.equal(calls.logError.length, 1);
  assert.equal(calls.notifyApproverOfError.length, 0);
});
