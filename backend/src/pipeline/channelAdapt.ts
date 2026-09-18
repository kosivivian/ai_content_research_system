import type { PipelineJob, Brief, Channel } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createChannelAdaptDeps } from "./channelAdaptDeps.js";

export interface ChannelDraftContent {
  channel: Channel;
  body: string;
}

export interface ChannelRevisionFeedback {
  channel: Channel;
  notes: string;
}

export interface ChannelAdaptDeps {
  getBrief(requestId: string): Promise<Brief>;
  getWinningArticle(requestId: string): Promise<{ draftId: string; bodyMarkdown: string }>;
  /** 1 on the first attempt for this request; increments each time channel_adapt re-runs after a revise verdict. */
  getNextVersion(requestId: string): Promise<number>;
  /** Per-channel feedback from the most recent evaluation, for channels that didn't pass. Empty on the first attempt. */
  getRevisionFeedback(requestId: string): Promise<ChannelRevisionFeedback[]>;
  generateChannelDrafts(
    articleBody: string,
    brief: Brief,
    feedback: ChannelRevisionFeedback[],
  ): Promise<{ drafts: ChannelDraftContent[]; tokensUsed: number }>;
  storeChannelDrafts(
    requestId: string,
    articleDraftId: string,
    version: number,
    drafts: ChannelDraftContent[],
  ): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Channel adapt stage: turns the winning article (picked by
 * evaluate_article) into LinkedIn/X/email drafts per
 * channel-formatting-rules.md. All three channels are generated and
 * revised together as one batch, not independently -- simpler than
 * per-channel revision tracking, and still satisfies "each gets its own
 * evaluation pass" (evaluate_channel scores them separately; this stage
 * just doesn't re-run only one of the three in isolation).
 */
export async function runChannelAdapt(job: PipelineJob, deps: ChannelAdaptDeps): Promise<StageResult> {
  const brief = await deps.getBrief(job.request_id);
  const article = await deps.getWinningArticle(job.request_id);
  const version = await deps.getNextVersion(job.request_id);
  const feedback = version > 1 ? await deps.getRevisionFeedback(job.request_id) : [];

  const { drafts, tokensUsed } = await deps.generateChannelDrafts(article.bodyMarkdown, brief, feedback);
  await deps.storeChannelDrafts(job.request_id, article.draftId, version, drafts);

  await deps.logActivity(job.request_id, "channel_drafts_generated", {
    version,
    channels: drafts.map((d) => d.channel),
    isRevision: feedback.length > 0,
  });

  return { nextAction: "advance", tokensUsed };
}

registerStage("channel_adapt", (job) => runChannelAdapt(job, createChannelAdaptDeps()));
