import type { SupabaseClient } from "@supabase/supabase-js";
import { weightedScore, ARTICLE_RUBRIC_WEIGHTS, type EvaluationDetail } from "./rubric.js";

export interface WinningArticleDraft {
  draftId: string;
  bodyMarkdown: string;
  version: number;
}

/**
 * The article draft evaluate_article picked as best at its latest
 * iteration -- same priority evaluate_article itself uses (pass beats
 * revise beats reject, ties broken by total score), recomputed here
 * rather than persisted, since the evaluations table is already the
 * source of truth for it. Used by channel_adapt to know what to adapt.
 */
export async function getWinningArticleDraft(
  supabase: SupabaseClient,
  requestId: string,
): Promise<WinningArticleDraft> {
  const { data, error } = await supabase
    .from("evaluations")
    .select("target_id, overall_status, rubric_scores, iteration_number")
    .eq("request_id", requestId)
    .eq("target_type", "article")
    .order("iteration_number", { ascending: false });
  if (error) throw new Error(`getWinningArticleDraft evaluations lookup failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`getWinningArticleDraft: no article evaluations found for request ${requestId}`);
  }

  const latestIteration = data[0]!.iteration_number;
  const latestRows = data.filter((r) => r.iteration_number === latestIteration);

  const byStatus = (status: "pass" | "revise" | "reject") =>
    latestRows.filter((r) => r.overall_status === status);
  const bestOf = (pool: typeof latestRows) =>
    pool.reduce((a, b) =>
      weightedScore((a.rubric_scores as EvaluationDetail)?.scores, ARTICLE_RUBRIC_WEIGHTS) >=
      weightedScore((b.rubric_scores as EvaluationDetail)?.scores, ARTICLE_RUBRIC_WEIGHTS)
        ? a
        : b,
    );

  const best = byStatus("pass")[0] ? bestOf(byStatus("pass")) : byStatus("revise")[0] ? bestOf(byStatus("revise")) : bestOf(latestRows);

  const { data: draft, error: draftError } = await supabase
    .from("article_drafts")
    .select("id, body_markdown, version")
    .eq("id", best.target_id)
    .single();
  if (draftError || !draft) {
    throw new Error(`getWinningArticleDraft: draft ${best.target_id} not found: ${draftError?.message ?? ""}`);
  }

  return { draftId: draft.id as string, bodyMarkdown: draft.body_markdown as string, version: draft.version as number };
}
