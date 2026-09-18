import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import { getLatestChannelDrafts } from "../pipeline/channelQueries.js";
import { createUpdate } from "../clients/buffer.js";
import { logActivity, logError, notifyApproverOfError } from "./notifications.js";
import type { BufferChannel, PublishingDeps, PublishingItem } from "./publishingLoop.js";

export function createSupabasePublishingDeps(supabase: SupabaseClient, env: Env): PublishingDeps {
  return {
    async claimNextItem() {
      const { data, error } = await supabase.rpc("claim_next_publishing_item");
      if (error) throw new Error(`claim_next_publishing_item failed: ${error.message}`);
      const [item] = (data ?? []) as PublishingItem[];
      return item ?? null;
    },

    async getChannelDraftBody(requestId, channel) {
      const { drafts } = await getLatestChannelDrafts(supabase, requestId);
      const draft = drafts.find((d) => d.channel === channel);
      if (!draft) throw new Error(`No "${channel}" channel draft found for request ${requestId}`);
      return draft.body;
    },

    getBufferProfileId(channel: BufferChannel) {
      return channel === "linkedin" ? env.BUFFER_PROFILE_ID_LINKEDIN : env.BUFFER_PROFILE_ID_X;
    },

    async createBufferUpdate(profileId, text, scheduledAt) {
      return createUpdate({ profileId, text, scheduledAt: scheduledAt ?? undefined });
    },

    async markScheduled(itemId, bufferPostId) {
      const { error } = await supabase
        .from("publishing_queue")
        .update({ status: "scheduled", buffer_post_id: bufferPostId })
        .eq("id", itemId);
      if (error) throw new Error(`markScheduled failed: ${error.message}`);
    },

    async markFailed(itemId) {
      const { error } = await supabase.from("publishing_queue").update({ status: "failed" }).eq("id", itemId);
      if (error) throw new Error(`markFailed failed: ${error.message}`);
    },

    logActivity: (requestId, action, detail = {}) => logActivity(supabase, requestId, action, detail),
    logError: (requestId, stage, detail) => logError(supabase, requestId, stage, detail),
    notifyApproverOfError: (requestId, stage, detail) => notifyApproverOfError(supabase, requestId, stage, detail),
  };
}
