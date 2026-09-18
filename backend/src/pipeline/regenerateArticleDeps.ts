import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import { getBriefFromDb, getRankedSourcesFromDb } from "./sourceQueries.js";
import { TARGET_WORD_RANGE } from "./generate.js";
import type { Brief } from "../types/db.js";
import type { RankedSourceForPlanning } from "./plan.js";
import type { RegenerateArticleDeps } from "./regenerateArticle.js";

export function createRegenerateArticleDeps(): RegenerateArticleDeps {
  const supabase = getSupabaseClient();

  return {
    getBrief: (requestId) => getBriefFromDb(supabase, requestId),
    getRankedSources: (requestId) => getRankedSourcesFromDb(supabase, requestId),

    async getArticleBody(articleDraftId) {
      const { data, error } = await supabase
        .from("article_drafts")
        .select("body_markdown")
        .eq("id", articleDraftId)
        .single();
      if (error || !data) throw new Error(`getArticleBody failed: ${error?.message ?? "not found"}`);
      return data.body_markdown as string;
    },

    async regenerateBody(currentBody, brief, sources, instructions) {
      const { result, inputTokens, outputTokens } = await completeStructured<{ body_markdown: string }>({
        tier: "strong",
        system: REGENERATE_SYSTEM_PROMPT,
        prompt: buildPrompt(currentBody, brief, sources, instructions),
        toolName: "submit_regenerated_article",
        toolDescription: "Records the rewritten article body.",
        inputSchema: {
          type: "object",
          properties: { body_markdown: { type: "string" } },
          required: ["body_markdown"],
        },
        maxTokens: 6144,
      });

      if (!result.body_markdown?.trim()) {
        throw new Error(`regenerateBody: model returned an empty body -- raw result: ${JSON.stringify(result)}`);
      }

      return { body: result.body_markdown, tokensUsed: inputTokens + outputTokens };
    },

    async updateArticleBody(articleDraftId, body) {
      const { error } = await supabase
        .from("article_drafts")
        .update({ body_markdown: body })
        .eq("id", articleDraftId);
      if (error) throw new Error(`updateArticleBody failed: ${error.message}`);
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

const REGENERATE_SYSTEM_PROMPT = `You rewrite an existing article draft that a human reviewer wants improved. Keep it grounded in the provided sources -- do not introduce claims the sources don't support. Preserve the overall topic and structure unless the reviewer's instructions say otherwise. Target ${TARGET_WORD_RANGE.min}-${TARGET_WORD_RANGE.max} words. If specific instructions are given, treat them as mandatory; otherwise use your own judgment to genuinely improve clarity, grounding, and completeness rather than making only cosmetic changes.`;

function buildPrompt(
  currentBody: string,
  brief: Brief,
  sources: RankedSourceForPlanning[],
  instructions: string | undefined,
): string {
  const sourceListing = sources
    .map((s, i) => `${i + 1}. (${s.sourceUrl ?? "user-provided text"})\n${s.excerpt}`)
    .join("\n\n");

  const parts = [
    `Topic: ${brief.topic ?? "(unknown)"}`,
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Tone: ${brief.tone ?? "professional"}`,
    `Current draft:\n${currentBody}`,
    sources.length > 0 ? `Available sources (cite these, not outside knowledge):\n${sourceListing}` : "No sources are available.",
  ];

  parts.push(
    instructions
      ? `Specific instructions from the reviewer (mandatory):\n${instructions}`
      : "No specific instructions were given -- use your own judgment to genuinely improve the draft.",
  );

  return parts.join("\n\n");
}
