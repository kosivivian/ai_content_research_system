import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import type { Outline, RankedSourceForPlanning } from "./plan.js";
import type { DraftOption, GenerateDeps, RevisionFeedback } from "./generate.js";
import { getRankedSourcesFromDb } from "./sourceQueries.js";
import { weightedScore, ARTICLE_RUBRIC_WEIGHTS, type EvaluationDetail } from "./rubric.js";

export function createGenerateDeps(): GenerateDeps {
  const supabase = getSupabaseClient();

  return {
    async getOutline(requestId) {
      const { data, error } = await supabase
        .from("content_plans")
        .select("id, outline")
        .eq("request_id", requestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error || !data) throw new Error(`getOutline failed: ${error?.message ?? "not found"}`);
      return { planId: data.id as string, outline: data.outline as Outline };
    },

    getRankedSources: (requestId) => getRankedSourcesFromDb(supabase, requestId),

    async getNextVersion(requestId) {
      const { data, error } = await supabase
        .from("article_drafts")
        .select("version")
        .eq("request_id", requestId)
        .order("version", { ascending: false })
        .limit(1);
      if (error) throw new Error(`getNextVersion failed: ${error.message}`);
      const latest = data?.[0]?.version as number | undefined;
      return (latest ?? 0) + 1;
    },

    async getRevisionFeedback(requestId) {
      const { data, error } = await supabase
        .from("evaluations")
        .select("notes, rubric_scores, iteration_number")
        .eq("request_id", requestId)
        .eq("target_type", "article")
        .order("iteration_number", { ascending: false });
      if (error) throw new Error(`getRevisionFeedback failed: ${error.message}`);
      if (!data || data.length === 0) return null;

      const latestIteration = data[0]!.iteration_number;
      const latestRows = data.filter((r) => r.iteration_number === latestIteration);

      const best = latestRows.reduce((a, b) =>
        weightedScore((a.rubric_scores as EvaluationDetail)?.scores, ARTICLE_RUBRIC_WEIGHTS) >=
        weightedScore((b.rubric_scores as EvaluationDetail)?.scores, ARTICLE_RUBRIC_WEIGHTS)
          ? a
          : b,
      );

      const detail = best.rubric_scores as EvaluationDetail;
      return {
        notes: best.notes ?? "",
        weakClaims: detail?.weak_claims ?? [],
        sectionsNeedingRevision: detail?.sections_needing_revision ?? [],
      } satisfies RevisionFeedback;
    },

    async generateOptions(outline, sources, feedback, numOptions, wordRange) {
      const { result, inputTokens, outputTokens } = await completeStructured<{
        options: { body_markdown: string; cited_source_indices: number[] }[];
      }>({
        tier: "strong",
        system: buildGenerateSystemPrompt(wordRange),
        prompt: buildGeneratePrompt(outline, sources, feedback, numOptions, wordRange),
        toolName: "submit_draft_options",
        toolDescription: "Records the generated article draft options.",
        inputSchema: buildDraftSchema(numOptions),
        // ~3072 tokens per option -- comfortable headroom over
        // TARGET_WORD_RANGE.max (~1300 words, ~1750 tokens of prose) plus
        // JSON/citation overhead -- scaled by numOptions rather than a
        // flat constant, so this stays correctly sized if NUM_DRAFT_OPTIONS
        // ever changes again. completeStructured throws a clear error if
        // this is ever too tight instead of silently truncating.
        maxTokens: numOptions * 3072,
      });

      const options: DraftOption[] = result.options.map((opt, i) => ({
        optionNumber: i + 1,
        bodyMarkdown: opt.body_markdown,
        citedSourceIds: opt.cited_source_indices
          .map((idx) => sources[idx - 1]?.id)
          .filter((id): id is string => Boolean(id)),
      }));

      return { options, tokensUsed: inputTokens + outputTokens };
    },

    async storeDrafts(requestId, planId, version, options) {
      const rows = options.map((opt) => ({
        request_id: requestId,
        plan_id: planId,
        option_number: opt.optionNumber,
        body_markdown: opt.bodyMarkdown,
        citations: opt.citedSourceIds.map((id) => ({ source_material_id: id })),
        version,
      }));
      const { error } = await supabase.from("article_drafts").insert(rows);
      if (error) throw new Error(`storeDrafts failed: ${error.message}`);
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

// A function, not a module-level const: generateDeps.ts can't import
// TARGET_WORD_RANGE from generate.ts (generate.ts imports createGenerateDeps
// from here, so that would be a circular import evaluated at module-load
// time -- exactly what broke here originally). wordRange comes in as a
// parameter instead, same as numOptions already does.
function buildGenerateSystemPrompt(wordRange: { min: number; max: number }): string {
  return `You write full article drafts from a pre-approved outline. Follow the outline's structure exactly (same title, same section order). Every factual claim must be traceable to one of the provided sources -- if the outline calls for something the sources don't support, write around it rather than inventing supporting detail. Reference sources by their 1-based index from the provided list in cited_source_indices; do not fabricate an index. Write in short paragraphs (2-3 sentences). Target ${wordRange.min}-${wordRange.max} words per draft -- a normal SEO blog-post length. Stay within that range: don't pad with filler to reach it, and don't cut the outline short to stay under it. If revision feedback is provided, treat it as mandatory: it describes specific problems with the previous draft that this one must fix.`;
}

function buildGeneratePrompt(
  outline: Outline,
  sources: RankedSourceForPlanning[],
  feedback: RevisionFeedback | null,
  numOptions: number,
  wordRange: { min: number; max: number },
): string {
  const sourceListing = sources
    .map((s, i) => `${i + 1}. (${s.sourceUrl ?? "user-provided text"})\n${s.excerpt}`)
    .join("\n\n");

  const parts = [
    `Outline:\n${JSON.stringify(outline, null, 2)}`,
    sources.length > 0 ? `Sources (cite by index):\n${sourceListing}` : "No sources are available.",
    `Write ${numOptions} distinct draft option(s) following this outline, each ${wordRange.min}-${wordRange.max} words.`,
  ];

  if (feedback) {
    parts.push(
      [
        "The previous attempt needed revision. Fix these specific problems:",
        feedback.notes,
        feedback.weakClaims.length > 0 ? `Weak/unsupported claims to remove or fix: ${feedback.weakClaims.join("; ")}` : "",
        feedback.sectionsNeedingRevision.length > 0
          ? `Sections that need rework: ${feedback.sectionsNeedingRevision.join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return parts.join("\n\n");
}

function buildDraftSchema(numOptions: number) {
  return {
    type: "object",
    properties: {
      options: {
        type: "array",
        minItems: 1,
        maxItems: numOptions,
        items: {
          type: "object",
          properties: {
            body_markdown: { type: "string", description: "The full article body, in markdown." },
            cited_source_indices: {
              type: "array",
              items: { type: "integer" },
              description: "1-based indices of the sources actually cited in this draft.",
            },
          },
          required: ["body_markdown", "cited_source_indices"],
        },
      },
    },
    required: ["options"],
  };
}
