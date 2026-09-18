import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import { getBriefFromDb } from "./sourceQueries.js";
import { getWinningArticleDraft } from "./winningDraft.js";
import { getLatestChannelDrafts } from "./channelQueries.js";
import type { Brief, Channel } from "../types/db.js";
import type { ChannelAdaptDeps, ChannelDraftContent, ChannelRevisionFeedback } from "./channelAdapt.js";

export function createChannelAdaptDeps(): ChannelAdaptDeps {
  const supabase = getSupabaseClient();

  return {
    getBrief: (requestId) => getBriefFromDb(supabase, requestId),

    async getWinningArticle(requestId) {
      const draft = await getWinningArticleDraft(supabase, requestId);
      return { draftId: draft.draftId, bodyMarkdown: draft.bodyMarkdown };
    },

    async getNextVersion(requestId) {
      const { version } = await getLatestChannelDrafts(supabase, requestId);
      return version + 1;
    },

    async getRevisionFeedback(requestId) {
      const { drafts } = await getLatestChannelDrafts(supabase, requestId);
      if (drafts.length === 0) return [];

      const { data, error } = await supabase
        .from("evaluations")
        .select("target_id, overall_status, notes")
        .eq("request_id", requestId)
        .eq("target_type", "channel_draft")
        .in(
          "target_id",
          drafts.map((d) => d.id),
        );
      if (error) throw new Error(`getRevisionFeedback failed: ${error.message}`);

      const byId = new Map(drafts.map((d) => [d.id, d.channel]));
      return (data ?? [])
        .filter((row) => row.overall_status !== "pass")
        .map((row) => ({
          channel: byId.get(row.target_id as string) as Channel,
          notes: row.notes as string,
        }));
    },

    async generateChannelDrafts(articleBody, brief, feedback) {
      const { result, inputTokens, outputTokens } = await completeStructured<{
        linkedin: string;
        x: string;
        email_subject: string;
        email_body: string;
      }>({
        tier: "strong",
        system: CHANNEL_ADAPT_SYSTEM_PROMPT,
        prompt: buildChannelAdaptPrompt(articleBody, brief, feedback),
        toolName: "submit_channel_drafts",
        toolDescription: "Records the LinkedIn, X, and email adaptations of the article.",
        inputSchema: CHANNEL_DRAFT_SCHEMA,
        // Modest bump for the same reason as generate's: three drafts in
        // one call adds up, and truncation now fails loudly rather than
        // producing a confusing downstream error either way.
        maxTokens: 6144,
      });

      // Forced tool-use is reliable, not guaranteed -- caught live: a
      // single-field object wrapper (the old { body: string } shape) once
      // confused the model into emitting stray tool-call-like text instead
      // of a plain string, which otherwise surfaces several layers
      // downstream as a confusing Postgres NOT NULL violation on
      // channel_drafts instead of a diagnosable cause here. Flattening the
      // schema (no more pointless single-field object nesting) removes the
      // likely trigger; this check is the remaining safety net.
      const missing = [
        !result.linkedin?.trim() && "linkedin",
        !result.x?.trim() && "x",
        !result.email_body?.trim() && "email body",
        !result.email_subject?.trim() && "email subject",
      ].filter((v): v is string => Boolean(v));
      if (missing.length > 0) {
        throw new Error(
          `generateChannelDrafts: model response is missing ${missing.join(", ")} -- raw result: ${JSON.stringify(result)}`,
        );
      }

      const drafts: ChannelDraftContent[] = [
        { channel: "linkedin", body: result.linkedin },
        { channel: "x", body: result.x },
        { channel: "email", body: `Subject: ${result.email_subject}\n\n${result.email_body}` },
      ];

      return { drafts, tokensUsed: inputTokens + outputTokens };
    },

    async storeChannelDrafts(requestId, articleDraftId, version, drafts) {
      const rows = drafts.map((d) => ({
        request_id: requestId,
        article_draft_id: articleDraftId,
        channel: d.channel,
        body: d.body,
        version,
      }));
      const { error } = await supabase.from("channel_drafts").insert(rows);
      if (error) throw new Error(`storeChannelDrafts failed: ${error.message}`);
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

const CHANNEL_ADAPT_SYSTEM_PROMPT = `You adapt an already-approved article into channel-specific posts. Follow these platform rules exactly:

LinkedIn: use the PAS structure (problem, agitation, solution). Short paragraphs. Bullets or simple symbols where they help. A small number of emojis only if they fit the brand voice. End with a clear call to action.

X: lead with the main benefit, insight, or hook. One core idea only. Use line breaks for readability. No more than 1-2 relevant hashtags. Only tag an account if the tag adds real value.

Email newsletter: a strong subject line with a clear benefit or point of intrigue. A 1-3 sentence intro. Make the main value section skimmable with subheadings or bullets. An optional secondary item (a quick tip, link, or update). A clear call to action. A friendly sign-off. Write like you're speaking to a smart, busy reader who trusts you to send something useful. Keep the body between 250 and 600 words.

Every claim must trace back to the source article -- do not introduce new claims or statistics that aren't already in it. If revision feedback is given for a channel, treat it as mandatory.`;

function buildChannelAdaptPrompt(articleBody: string, brief: Brief, feedback: ChannelRevisionFeedback[]): string {
  const parts = [
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Tone: ${brief.tone ?? "professional"}`,
    `Source article:\n${articleBody}`,
  ];

  if (feedback.length > 0) {
    parts.push(
      `The previous attempt needed revision on these channels:\n${feedback
        .map((f) => `${f.channel}: ${f.notes}`)
        .join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

const CHANNEL_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    linkedin: { type: "string", description: "The full LinkedIn post body." },
    x: { type: "string", description: "The full X (Twitter) post body." },
    email_subject: { type: "string" },
    email_body: { type: "string" },
  },
  required: ["linkedin", "x", "email_subject", "email_body"],
};
