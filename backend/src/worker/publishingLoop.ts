import type { Channel } from "../types/db.js";

export type BufferChannel = Exclude<Channel, "email">;

export interface PublishingItem {
  id: string;
  request_id: string;
  channel: Channel;
  scheduled_time: string | null;
}

export interface PublishingDeps {
  claimNextItem: () => Promise<PublishingItem | null>;
  getChannelDraftBody: (requestId: string, channel: Channel) => Promise<string>;
  /** Buffer's API publishes to a "profile" (connected account), not a raw channel name. Undefined means that channel isn't wired up. */
  getBufferProfileId: (channel: BufferChannel) => string | undefined;
  createBufferUpdate: (profileId: string, text: string, scheduledAt: Date | null) => Promise<{ id: string }>;
  markScheduled: (itemId: string, bufferPostId: string) => Promise<void>;
  markFailed: (itemId: string) => Promise<void>;
  logActivity: (requestId: string, action: string, detail?: Record<string, unknown>) => Promise<void>;
  logError: (requestId: string, stage: string, detail: Record<string, unknown>) => Promise<void>;
  notifyApproverOfError: (requestId: string, stage: string, detail: Record<string, unknown>) => Promise<void>;
}

export type TickResult = "processed" | "idle";

/**
 * Publishing_queue is a separate table/queue from pipeline_jobs -- it only
 * exists once a request is approved, has no multi-stage chain, and its
 * "publish" step is a single external call (Buffer) rather than an LLM
 * call, so it gets its own small loop instead of another pipeline stage.
 *
 * Email is not a Buffer-supported channel (Buffer only manages social
 * profiles): per the PRD, email is flagged for manual send rather than
 * silently faked. The creator's review page shows the email body directly
 * for copy/paste, so no publishing_queue row is ever created for it in the
 * first place -- if one somehow is, it's treated as a stage bug, not a
 * per-item failure, since there is genuinely nothing for this worker to do
 * with it.
 */
export async function runOnePublishTick(deps: PublishingDeps): Promise<TickResult> {
  const item = await deps.claimNextItem();
  if (!item) return "idle";

  if (item.channel === "email") {
    await deps.logError(item.request_id, "publish:email", {
      message: "publishing_queue should never contain an email row -- email is a manual-send channel handled entirely in the UI.",
    });
    await deps.markFailed(item.id);
    return "processed";
  }

  try {
    const profileId = deps.getBufferProfileId(item.channel);
    if (!profileId) {
      throw new Error(`No Buffer profile configured for channel "${item.channel}" (set BUFFER_PROFILE_ID_${item.channel.toUpperCase()})`);
    }

    const body = await deps.getChannelDraftBody(item.request_id, item.channel);
    const scheduledAt = item.scheduled_time ? new Date(item.scheduled_time) : null;
    const update = await deps.createBufferUpdate(profileId, body, scheduledAt);

    await deps.markScheduled(item.id, update.id);
    await deps.logActivity(item.request_id, "publishing_scheduled", {
      channel: item.channel,
      bufferPostId: update.id,
      scheduledAt: item.scheduled_time,
    });
  } catch (err) {
    const detail = { message: err instanceof Error ? err.message : String(err), channel: item.channel };
    await deps.markFailed(item.id);
    await deps.logError(item.request_id, `publish:${item.channel}`, detail);
    await deps.notifyApproverOfError(item.request_id, `publish:${item.channel}`, detail);
  }

  return "processed";
}

export interface RunPublishingWorkerOptions {
  pollIntervalMs: number;
  signal?: AbortSignal;
}

/** A single polling slot -- publishing volume never approaches the 5-way concurrency the main pipeline worker needs. */
export async function runPublishingWorker(deps: PublishingDeps, opts: RunPublishingWorkerOptions): Promise<void> {
  let stopped = false;
  opts.signal?.addEventListener("abort", () => {
    stopped = true;
  });

  while (!stopped) {
    let result: TickResult;
    try {
      result = await runOnePublishTick(deps);
    } catch (err) {
      console.error("Unhandled error in publishing tick:", err);
      result = "idle";
    }
    if (result === "idle") {
      await sleep(opts.pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
