import type { PipelineJob, Brief, Channel } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createRegenerateChannelDeps } from "./regenerateChannelDeps.js";

export interface RegenerateChannelPayload {
  channelDraftId: string;
  instructions?: string;
}

export interface RegenerateChannelDeps {
  getBrief(requestId: string): Promise<Brief>;
  getChannelDraft(channelDraftId: string): Promise<{ channel: Channel; body: string; articleDraftId: string }>;
  getArticleBody(articleDraftId: string): Promise<string>;
  regenerateBody(
    channel: Channel,
    currentBody: string,
    articleBody: string,
    brief: Brief,
    instructions: string | undefined,
  ): Promise<{ body: string; tokensUsed: number }>;
  updateChannelBody(channelDraftId: string, body: string): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

function parsePayload(job: PipelineJob): RegenerateChannelPayload {
  const payload = job.payload as Partial<RegenerateChannelPayload> | undefined;
  if (!payload?.channelDraftId) {
    throw new Error(`regenerate_channel: job payload missing channelDraftId (request ${job.request_id})`);
  }
  return { channelDraftId: payload.channelDraftId, instructions: payload.instructions };
}

/**
 * Creator-triggered, one-shot: rewrites a single channel draft in place --
 * the other two channels are untouched, unlike channel_adapt which always
 * regenerates all three together. That distinction matters now that
 * creators can hand-edit channel drafts directly (20250101000018):
 * regenerating "the whole batch" would silently blow away an edit to a
 * channel the reviewer didn't even ask to change.
 */
export async function runRegenerateChannel(job: PipelineJob, deps: RegenerateChannelDeps): Promise<StageResult> {
  const { channelDraftId, instructions } = parsePayload(job);

  const [brief, draft] = await Promise.all([deps.getBrief(job.request_id), deps.getChannelDraft(channelDraftId)]);
  const articleBody = await deps.getArticleBody(draft.articleDraftId);

  const { body, tokensUsed } = await deps.regenerateBody(draft.channel, draft.body, articleBody, brief, instructions);
  await deps.updateChannelBody(channelDraftId, body);

  await deps.logActivity(job.request_id, "channel_draft_regenerated", {
    channelDraftId,
    channel: draft.channel,
    instructions: instructions ?? null,
  });

  return { nextAction: "advance", tokensUsed };
}

registerStage("regenerate_channel", (job) => runRegenerateChannel(job, createRegenerateChannelDeps()));
