import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import type { Brief } from "../types/db.js";
import type { Outline, PlanDeps, RankedSourceForPlanning } from "./plan.js";
import { getBriefFromDb, getRankedSourcesFromDb } from "./sourceQueries.js";

export function createPlanDeps(): PlanDeps {
  const supabase = getSupabaseClient();

  return {
    getBrief: (requestId) => getBriefFromDb(supabase, requestId),
    getRankedSources: (requestId) => getRankedSourcesFromDb(supabase, requestId),

    async generateOutline(brief, sources) {
      const { result, inputTokens, outputTokens } = await completeStructured<Outline>({
        tier: "strong",
        system: PLAN_SYSTEM_PROMPT,
        prompt: buildPlanPrompt(brief, sources),
        toolName: "propose_outline",
        toolDescription: "Records the structural outline for this piece of content.",
        inputSchema: OUTLINE_SCHEMA,
        maxTokens: 2048,
      });

      // Forced tool-use is reliable, not guaranteed -- the schema marks
      // these required arrays, but a shape mismatch here would otherwise
      // only surface as a frontend crash (outline.secondary_keywords.map
      // is not a function) several steps and possibly days later, once
      // someone actually opens the Outline tab.
      if (!Array.isArray(result.secondary_keywords) || !Array.isArray(result.sections)) {
        throw new Error(
          `generateOutline: model response has a malformed shape -- raw result: ${JSON.stringify(result)}`,
        );
      }

      return { outline: result, tokensUsed: inputTokens + outputTokens };
    },

    async storeOutline(requestId, outline) {
      const { error } = await supabase.from("content_plans").insert({
        request_id: requestId,
        outline,
      });
      if (error) throw new Error(`storeOutline failed: ${error.message}`);
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

const PLAN_SYSTEM_PROMPT = `You plan the structure of an SEO article before any of it is written. Follow these structural rules:
- Exactly one title (functions as the single H1). Include the primary keyword in the title and make sure it can naturally appear in the first 100 words of the article.
- Sections are H2, with H3 subsections only where genuinely useful.
- Plan for short paragraphs (2-3 sentences) -- reflect that in how granular the key_points are, don't plan one giant section that would force a wall of text.
- Identify 2-3 secondary keywords that belong across the body/headers.
- End with a clear call to action.
- Base the outline only on the brief and the provided sources -- do not plan sections that would require claims the sources can't support.`;

function buildPlanPrompt(brief: Brief, sources: RankedSourceForPlanning[]): string {
  const listing = sources
    .map((s, i) => `${i + 1}. (${s.sourceUrl ?? "user-provided text"})\n${s.excerpt}`)
    .join("\n\n");

  return [
    `Topic: ${brief.topic ?? "(unknown)"}`,
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Tone: ${brief.tone ?? "professional"}`,
    `Overview: ${brief.overview ?? "(none)"}`,
    sources.length > 0 ? `Available sources:\n${listing}` : "No sources are available -- plan conservatively.",
  ].join("\n\n");
}

const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The article title (the single H1)." },
    primary_keyword: { type: "string" },
    secondary_keywords: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    hook: { type: "string", description: "A one- to two-sentence opening hook." },
    sections: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          level: { type: "string", enum: ["h2", "h3"] },
          key_points: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["heading", "level", "key_points"],
      },
    },
    cta: { type: "string" },
  },
  required: ["title", "primary_keyword", "secondary_keywords", "hook", "sections", "cta"],
};
