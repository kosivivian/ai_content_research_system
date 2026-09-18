import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Channel, Evaluation } from "@/lib/types/db";

// Mirrors backend/src/pipeline/rubric.ts's ARTICLE_RUBRIC_WEIGHTS /
// ARTICLE_PASS_THRESHOLD -- duplicated here purely for display (no shared
// package between frontend/backend in this project). The backend is the
// only thing that actually enforces the pass/revise decision; keep these
// two in sync by hand if the weights ever change.
const ARTICLE_RUBRIC_WEIGHTS: Record<string, number> = {
  factual_consistency: 5,
  source_grounding: 5,
  topic_relevance: 4,
  audience_fit: 4,
  clarity: 4,
  seo_fit: 4,
  completeness: 3,
  tone: 2,
};
const ARTICLE_PASS_THRESHOLD = 3.9;

const CRITERION_LABEL: Record<string, string> = {
  factual_consistency: "Factual consistency",
  source_grounding: "Source grounding",
  topic_relevance: "Topic relevance",
  audience_fit: "Audience fit",
  clarity: "Clarity",
  seo_fit: "SEO fit",
  completeness: "Completeness",
  tone: "Tone",
  channel_fit: "Channel fit",
};

const VERDICT_VARIANT: Record<string, BadgeProps["variant"]> = {
  pass: "success",
  revise: "warning",
  reject: "danger",
};

function ScoreRow({ label, score, weight }: { label: string; score: number; weight?: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        {label}
        {typeof weight === "number" && <span className="ml-1 text-[10px] opacity-70">(weight {weight})</span>}
      </span>
      <span className="font-medium tabular-nums">{score}/5</span>
    </div>
  );
}

/**
 * Per-criterion score breakdown for the current best article draft and
 * each latest channel draft -- the badges elsewhere on the page show only
 * the final verdict/weighted total, not what actually drove it.
 */
export function EvaluationBreakdown({
  articleEvaluation,
  channelEvaluations,
}: {
  articleEvaluation: Evaluation | undefined;
  channelEvaluations: { channel: Channel; evaluation: Evaluation }[];
}) {
  if (!articleEvaluation && channelEvaluations.length === 0) return null;

  const weighted = articleEvaluation?.rubric_scores.weighted_score;
  const articleCriteria = Object.entries(ARTICLE_RUBRIC_WEIGHTS).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evaluation breakdown</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {articleEvaluation && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Article</p>
              <Badge variant={typeof weighted === "number" && weighted >= ARTICLE_PASS_THRESHOLD ? "success" : "warning"}>
                {typeof weighted === "number" ? `${weighted.toFixed(2)}/5` : articleEvaluation.overall_status}
              </Badge>
            </div>
            {articleCriteria.map(([key, weight]) => {
              const score = articleEvaluation.rubric_scores.scores?.[key];
              if (typeof score !== "number") return null;
              return <ScoreRow key={key} label={CRITERION_LABEL[key] ?? key} score={score} weight={weight} />;
            })}
            <p className="pt-1 text-[10px] text-muted-foreground">Pass threshold: {ARTICLE_PASS_THRESHOLD}/5 weighted average.</p>
          </div>
        )}

        {channelEvaluations.map(({ channel, evaluation }) => (
          <div key={channel} className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-0 first:pt-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium capitalize text-muted-foreground">{channel}</p>
              <Badge variant={VERDICT_VARIANT[evaluation.overall_status] ?? "default"}>{evaluation.overall_status}</Badge>
            </div>
            {Object.entries(evaluation.rubric_scores.scores ?? {}).map(([key, score]) => (
              <ScoreRow key={key} label={CRITERION_LABEL[key] ?? key} score={score as number} />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
