// Shared between the two evaluate stages (which produce these) and
// generateDeps.ts (which reads the most recent article one back as
// revision feedback) -- content-evaluation-rubric.md's criteria, split
// across the two evaluation passes it's used for.
export const ARTICLE_RUBRIC_CRITERIA = [
  "topic_relevance",
  "source_grounding",
  "factual_consistency",
  "audience_fit",
  "tone",
  "seo_fit",
  "clarity",
  "completeness",
] as const;

/** Channel drafts are short-form and already inherit the approved article's grounding/relevance, so their pass is scoped to what actually differs per channel. */
export const CHANNEL_RUBRIC_CRITERIA = ["channel_fit", "tone", "clarity"] as const;

/**
 * Importance weights (1-5) for the article rubric -- factual accuracy and
 * source grounding matter most (an unreliable article is unusable no
 * matter how well it reads); tone matters least (a slightly-off tone
 * shouldn't block an otherwise-solid, well-grounded draft). Channel
 * evaluation stays unweighted (equal-weight totalScore) since it's a much
 * shorter rubric with no requested weighting.
 */
export const ARTICLE_RUBRIC_WEIGHTS: Record<(typeof ARTICLE_RUBRIC_CRITERIA)[number], number> = {
  factual_consistency: 5,
  source_grounding: 5,
  topic_relevance: 4,
  audience_fit: 4,
  clarity: 4,
  completeness: 3,
  tone: 2,
  seo_fit: 4,
};

/** A draft's weighted score (out of 5) must meet this to pass -- see weightedScore(). Below it, the draft goes back for revision regardless of how any single criterion scored. */
export const ARTICLE_PASS_THRESHOLD = 3.9;

/** Stored in evaluations.rubric_scores (jsonb) -- one blob per draft per evaluation pass. Keys vary by which rubric produced it (article vs. channel), so this stays a plain string-keyed map rather than a criterion-specific type. */
export interface EvaluationDetail {
  scores: Record<string, number>;
  weak_claims: string[];
  sections_needing_revision: string[];
  /** Only set for article evaluations (weighted); channel evaluations don't carry this. */
  weighted_score?: number;
}

/** Unweighted sum, used for channel evaluations (and as a tiebreaker anywhere weights don't apply). */
export function totalScore(scores: Record<string, number> | undefined): number {
  if (!scores) return 0;
  return Object.values(scores).reduce((sum: number, v) => sum + (typeof v === "number" ? v : 0), 0);
}

/**
 * sum(score * weight) / sum(weight) -- the article rubric's actual pass/
 * revise decision (see ARTICLE_PASS_THRESHOLD), not just a tiebreaker.
 * Missing criteria are skipped rather than treated as 0, so a partial
 * `scores` object still produces a meaningful average instead of being
 * unfairly dragged down.
 */
export function weightedScore(
  scores: Record<string, number> | undefined,
  weights: Record<string, number>,
): number {
  if (!scores) return 0;
  let weightedSum = 0;
  let weightSum = 0;
  for (const [criterion, weight] of Object.entries(weights)) {
    const score = scores[criterion];
    if (typeof score !== "number") continue;
    weightedSum += score * weight;
    weightSum += weight;
  }
  return weightSum === 0 ? 0 : weightedSum / weightSum;
}

/** After this many generate/evaluate (or channel_adapt/evaluate_channel) rounds without a "pass", stop auto-revising and forward the best-so-far draft anyway, flagged for a human. Bounds token spend on a request that just won't converge. */
export const MAX_AUTO_REVISE_ITERATIONS = 3;
