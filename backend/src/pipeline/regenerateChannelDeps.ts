import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import { getBriefFromDb } from "./sourceQueries.js";
import type { Brief, Channel } from "../types/db.js";
import type { RegenerateChannelDeps } from "./regenerateChannel.js";

export function createRegenerateChannelDeps(): RegenerateChannelDeps {
  const supabase = getSupabaseClient();

  return {
    getBrief: (requestId) => getBriefFromDb(supabase, requestId),

    async getChannelDraft(channelDraftId) {
      const { data, error } = await supabase
        .from("channel_drafts")
        .select("channel, body, article_draft_id")
        .eq("id", channelDraftId)
        .single();
      if (error || !data) throw new Error(`getChannelDraft failed: ${error?.message ?? "not found"}`);
      return {
        channel: data.channel as Channel,
        body: data.body as string,
        articleDraftId: data.article_draft_id as string,
      };
    },

    async getArticleBody(articleDraftId) {
      const { data, error } = await supabase
        .from("article_drafts")
        .select("body_markdown")
        .eq("id", articleDraftId)
        .single();
      if (error || !data) throw new Error(`getArticleBody failed: ${error?.message ?? "not found"}`);
      return data.body_markdown as string;
    },

    async regenerateBody(channel, currentBody, articleBody, brief, instructions) {
      const { result, inputTokens, outputTokens } = await completeStructured<{ body: string }>({
        tier: "strong",
        system: buildSystemPrompt(channel),
        prompt: buildPrompt(currentBody, articleBody, brief, instructions),
        toolName: "submit_regenerated_channel_draft",
        toolDescription: `Records the rewritten ${channel} draft.`,
        inputSchema: {
          type: "object",
          properties: { body: { type: "string" } },
          required: ["body"],
        },
        maxTokens: 3072,
      });

      if (!result.body?.trim()) {
        throw new Error(`regenerateBody: model returned an empty body for ${channel} -- raw result: ${JSON.stringify(result)}`);
      }

      return { body: result.body, tokensUsed: inputTokens + outputTokens };
    },

    async updateChannelBody(channelDraftId, body) {
      const { error } = await supabase.from("channel_drafts").update({ body }).eq("id", channelDraftId);
      if (error) throw new Error(`updateChannelBody failed: ${error.message}`);
    },

    async logActivity(requestId, action, detail = {}) {
      const { error } = await supabase.from("activity_log").insert({
        request_id: requestId,
        actor_type: "ai_agent",
        action,
        detail,
      });
      if (error) throw new Error(`logActivity failed: ${error.message}`);
    },
  };
}

const CHANNEL_RULES: Record<Channel, string> = {
  linkedin:
    "LinkedIn: use the PAS structure (problem, agitation, solution). Short paragraphs. A small number of emojis only if they fit the brand voice. End with a clear call to action.",
  x: "X: lead with the main benefit, insight, or hook. One core idea only. Use line breaks for readability. No more than 1-2 relevant hashtags.",
  email:
    'Email newsletter: a strong subject line, a 1-3 sentence intro, a skimmable value section, a clear call to action, a friendly sign-off. Keep the body between 250 and 600 words. Format the output as the subject line first, exactly as "Subject: ...", then a blank line, then the body -- matching how it\'s stored.',
};

function buildSystemPrompt(channel: Channel): string {
  return `You rewrite an existing ${channel} post that a human reviewer wants improved. ${CHANNEL_RULES[channel]} Every claim must trace back to the source article -- do not introduce new claims or statistics that aren't already in it. If specific instructions are given, treat them as mandatory.`;
}

function buildPrompt(
  currentBody: string,
  articleBody: string,
  brief: Brief,
  instructions: string | undefined,
): string {
  const parts = [
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Tone: ${brief.tone ?? "professional"}`,
    `Source article:\n${articleBody}`,
    `Current draft:\n${currentBody}`,
  ];

  parts.push(
    instructions
      ? `Specific instructions from the reviewer (mandatory):\n${instructions}`
      : "No specific instructions were given -- use your own judgment to genuinely improve the draft.",
  );

  return parts.join("\n\n");
}
