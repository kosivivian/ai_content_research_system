import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import { getBriefFromDb } from "./sourceQueries.js";
import { getLatestChannelDrafts } from "./channelQueries.js";
import { CHANNEL_RUBRIC_CRITERIA } from "./rubric.js";
import type { Brief, Channel } from "../types/db.js";
import type { ChannelDraftForEvaluation, ChannelEvaluation, EvaluateChannelDeps } from "./evaluateChannel.js";

export function createEvaluateChannelDeps(): EvaluateChannelDeps {
  const supabase = getSupabaseClient();

  return {
    getBrief: (requestId) => getBriefFromDb(supabase, requestId),

    async getLatestChannelDrafts(requestId) {
      return getLatestChannelDrafts(supabase, requestId);
    },

    async evaluateChannelDrafts(brief, drafts) {
      const { result, inputTokens, outputTokens } = await completeStructured<{
        evaluations: {
          channel: Channel;
          scores: Record<string, number>;
          overall_status: "pass" | "revise" | "reject";
          notes: string;
          weak_claims: string[];
          sections_needing_revision: string[];
        }[];
      }>({
        tier: "fast",
        system: EVALUATE_CHANNEL_SYSTEM_PROMPT,
        prompt: buildEvaluatePrompt(brief, drafts),
        toolName: "submit_channel_evaluations",
        toolDescription: "Records the evaluation for each channel draft.",
        inputSchema: buildEvaluationSchema(),
        maxTokens: 2048,
      });

      const evaluations: ChannelEvaluation[] = result.evaluations.map((e) => ({
        channel: e.channel,
        detail: {
          scores: e.scores,
          weak_claims: e.weak_claims,
          sections_needing_revision: e.sections_needing_revision,
        },
        overallStatus: e.overall_status,
        notes: e.notes,
      }));

      return { evaluations, tokensUsed: inputTokens + outputTokens };
    },

    async storeEvaluations(requestId, version, drafts, evaluations) {
      const rows = evaluations.map((e) => {
        const draft = drafts.find((d) => d.channel === e.channel);
        if (!draft) throw new Error(`storeEvaluations: no draft found for channel ${e.channel}`);
        return {
          request_id: requestId,
          target_type: "channel_draft" as const,
          target_id: draft.id,
          rubric_scores: e.detail,
          overall_status: e.overallStatus,
          notes: e.notes,
          iteration_number: version,
        };
      });

      const { error } = await supabase.from("evaluations").insert(rows);
      if (error) throw new Error(`storeEvaluations failed: ${error.message}`);
    },

    async markAwaitingCreator(requestId) {
      const { error } = await supabase
        .from("content_requests")
        .update({ status: "awaiting_creator" })
        .eq("id", requestId);
      if (error) throw new Error(`markAwaitingCreator failed: ${error.message}`);
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

const EVALUATE_CHANNEL_SYSTEM_PROMPT = `You evaluate channel-adapted posts (LinkedIn, X, email) against platform formatting rules. LinkedIn should use the PAS structure, short paragraphs, a clear CTA. X should lead with one core idea/hook, use line breaks, at most 1-2 hashtags. Email should have a strong subject line, a short intro, a skimmable value section, a CTA, and stay 250-600 words. Score channel_fit (does it actually follow that platform's rules), tone (matches brand/audience), and clarity (skimmable, direct) from 0-5 each. overall_status is "pass" only if it's genuinely ready to publish as-is.`;

function buildEvaluatePrompt(brief: Brief, drafts: ChannelDraftForEvaluation[]): string {
  const listing = drafts.map((d) => `--- ${d.channel} ---\n${d.body}`).join("\n\n");
  return [
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Tone: ${brief.tone ?? "professional"}`,
    `Channel drafts:\n${listing}`,
  ].join("\n\n");
}

function buildEvaluationSchema() {
  const scoreProperties = Object.fromEntries(
    CHANNEL_RUBRIC_CRITERIA.map((c) => [c, { type: "integer", minimum: 0, maximum: 5 }]),
  );

  return {
    type: "object",
    properties: {
      evaluations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            channel: { type: "string", enum: ["linkedin", "x", "email"] },
            scores: {
              type: "object",
              properties: scoreProperties,
              required: [...CHANNEL_RUBRIC_CRITERIA],
            },
            overall_status: { type: "string", enum: ["pass", "revise", "reject"] },
            notes: { type: "string" },
            weak_claims: { type: "array", items: { type: "string" } },
            sections_needing_revision: { type: "array", items: { type: "string" } },
          },
          required: ["channel", "scores", "overall_status", "notes", "weak_claims", "sections_needing_revision"],
        },
      },
    },
    required: ["evaluations"],
  };
}
