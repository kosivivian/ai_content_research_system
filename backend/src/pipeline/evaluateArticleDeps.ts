import { getSupabaseClient } from "../clients/supabase.js";
import { completeStructured } from "../clients/anthropic.js";
import { getBriefFromDb } from "./sourceQueries.js";
import { ARTICLE_RUBRIC_CRITERIA, ARTICLE_RUBRIC_WEIGHTS, ARTICLE_PASS_THRESHOLD, weightedScore, type EvaluationDetail } from "./rubric.js";
import type { DraftEvaluation, DraftForEvaluation, EvaluateArticleDeps } from "./evaluateArticle.js";
import type { Brief } from "../types/db.js";

export function createEvaluateArticleDeps(): EvaluateArticleDeps {
  const supabase = getSupabaseClient();

  return {
    getBrief: (requestId) => getBriefFromDb(supabase, requestId),

    async getLatestDrafts(requestId) {
      const { data: latest, error: latestError } = await supabase
        .from("article_drafts")
        .select("version")
        .eq("request_id", requestId)
        .order("version", { ascending: false })
        .limit(1);
      if (latestError) throw new Error(`getLatestDrafts version lookup failed: ${latestError.message}`);
      const version = latest?.[0]?.version as number | undefined;
      if (version === undefined) return { version: 0, drafts: [] };

      const { data, error } = await supabase
        .from("article_drafts")
        .select("id, option_number, body_markdown")
        .eq("request_id", requestId)
        .eq("version", version)
        .order("option_number");
      if (error) throw new Error(`getLatestDrafts fetch failed: ${error.message}`);

      const drafts: DraftForEvaluation[] = (data ?? []).map((row) => ({
        id: row.id as string,
        optionNumber: row.option_number as number,
        bodyMarkdown: row.body_markdown as string,
      }));

      return { version, drafts };
    },

    async evaluateDrafts(brief, drafts) {
      const { result, inputTokens, outputTokens } = await completeStructured<{
        evaluations: {
          option_number: number;
          scores: Record<string, number>;
          notes: string;
          weak_claims: string[];
          sections_needing_revision: string[];
        }[];
      }>({
        tier: "strong",
        system: EVALUATE_SYSTEM_PROMPT,
        prompt: buildEvaluatePrompt(brief, drafts),
        toolName: "submit_evaluations",
        toolDescription: "Records the rubric evaluation for each draft option.",
        inputSchema: buildEvaluationSchema(),
        maxTokens: 4096,
      });

      // pass/revise is a deterministic function of the weighted score
      // against ARTICLE_PASS_THRESHOLD -- not the model's own opinion. The
      // model only supplies the raw per-criterion scores (and the
      // qualitative weak_claims/notes that drive the next revision); it no
      // longer gets a say in the actual pass/fail call.
      const evaluations: DraftEvaluation[] = result.evaluations.map((e) => {
        const weighted = weightedScore(e.scores, ARTICLE_RUBRIC_WEIGHTS);
        return {
          optionNumber: e.option_number,
          detail: {
            scores: e.scores as EvaluationDetail["scores"],
            weak_claims: e.weak_claims,
            sections_needing_revision: e.sections_needing_revision,
            weighted_score: weighted,
          },
          overallStatus: weighted >= ARTICLE_PASS_THRESHOLD ? "pass" : "revise",
          notes: e.notes,
        };
      });

      return { evaluations, tokensUsed: inputTokens + outputTokens };
    },

    async storeEvaluations(requestId, version, drafts, evaluations) {
      const rows = evaluations.map((e) => {
        const draft = drafts.find((d) => d.optionNumber === e.optionNumber);
        if (!draft) throw new Error(`storeEvaluations: no draft found for option ${e.optionNumber}`);
        return {
          request_id: requestId,
          target_type: "article" as const,
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

const EVALUATE_SYSTEM_PROMPT = `You evaluate draft articles against a fixed rubric before a human ever sees them. Score each criterion from 1 (fails badly) to 5 (excellent) -- be genuinely critical, not generous by default. A draft that merely restates the topic without grounding claims in the given sources should score low on source_grounding and factual_consistency, not be waved through. Whether the draft passes is decided afterward from a weighted average of your scores, not by you -- your job is just to score each criterion honestly on its own merits. Always list concrete weak_claims and sections_needing_revision (even when the draft is otherwise strong) -- these get fed back into the next draft attempt verbatim if revision turns out to be needed, so vague notes produce vague revisions.`;

function buildEvaluatePrompt(brief: Brief, drafts: DraftForEvaluation[]): string {
  const listing = drafts.map((d) => `--- Option ${d.optionNumber} ---\n${d.bodyMarkdown}`).join("\n\n");
  return [
    `Topic: ${brief.topic ?? "(unknown)"}`,
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Tone: ${brief.tone ?? "professional"}`,
    `Overview: ${brief.overview ?? "(none)"}`,
    `Draft options:\n${listing}`,
  ].join("\n\n");
}

function buildEvaluationSchema() {
  const scoreProperties = Object.fromEntries(
    ARTICLE_RUBRIC_CRITERIA.map((c) => [c, { type: "integer", minimum: 1, maximum: 5 }]),
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
            option_number: { type: "integer" },
            scores: {
              type: "object",
              properties: scoreProperties,
              required: [...ARTICLE_RUBRIC_CRITERIA],
            },
            notes: { type: "string" },
            weak_claims: { type: "array", items: { type: "string" } },
            sections_needing_revision: { type: "array", items: { type: "string" } },
          },
          required: ["option_number", "scores", "notes", "weak_claims", "sections_needing_revision"],
        },
      },
    },
    required: ["evaluations"],
  };
}
