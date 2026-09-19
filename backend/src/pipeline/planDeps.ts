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
      // Typed loosely on purpose -- secondary_keywords' real runtime shape
      // doesn't always match Outline's declared type (see below), so this
      // can't be typed as Outline until after that's actually validated.
      const { result, inputTokens, outputTokens } = await completeStructured<Omit<Outline, "secondary_keywords"> & {
        secondary_keywords: unknown;
      }>({
        tier: "strong",
        system: PLAN_SYSTEM_PROMPT,
        prompt: buildPlanPrompt(brief, sources),
        toolName: "propose_outline",
        toolDescription: "Records the structural outline for this piece of content.",
        inputSchema: OUTLINE_SCHEMA,
        maxTokens: 2048,
      });

      // Forced tool-use is reliable, not guaranteed. Reproduced 100% of the
      // time against a real project: despite the schema declaring
      // secondary_keywords a JSON array, the model consistently returned
      // it as a single comma-separated string (e.g. "keyword one, keyword
      // two") -- every other field, including the other array (sections),
      // came back correctly shaped. That's recoverable data, not garbage,
      // so coerce it instead of failing the whole stage over a formatting
      // quirk. sections has no such recovery path (it's a structural
      // array of objects, not a delimited list), so a genuine shape
      // mismatch there still fails loudly.
      const secondaryKeywords = Array.isArray(result.secondary_keywords)
        ? result.secondary_keywords
        : typeof result.secondary_keywords === "string"
          ? result.secondary_keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean)
          : null;

      if (!secondaryKeywords || !Array.isArray(result.sections)) {
        throw new Error(
          `generateOutline: model response has a malformed shape -- raw result: ${JSON.stringify(result)}`,
        );
      }

      const outline: Outline = { ...result, secondary_keywords: secondaryKeywords };
      return { outline, tokensUsed: inputTokens + outputTokens };
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
- Identify 2-3 secondary keywords that belong across the body/headers. secondary_keywords must be a JSON array of separate short strings (e.g. ["keyword one", "keyword two"]) -- never a single comma-separated string.
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
