import { Badge } from "@/components/ui/badge";
import type { ArticleDraft, Evaluation } from "@/lib/types/db";

const VERDICT_VARIANT = {
  pass: "success",
  revise: "warning",
  reject: "danger",
} as const;

/** Every generate/evaluate_article round for this request, newest version first, so the most recent attempt is immediately visible. */
export function ArticleRevisionHistoryTab({
  drafts,
  evaluations,
}: {
  drafts: ArticleDraft[];
  evaluations: Evaluation[];
}) {
  if (drafts.length === 0) {
    return <p className="text-sm text-muted-foreground">No drafts yet.</p>;
  }

  const evaluationsByTargetId = new Map(evaluations.map((e) => [e.target_id, e]));
  const versions = Array.from(new Set(drafts.map((d) => d.version))).sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-4">
      {versions.map((version) => {
        const versionDrafts = drafts.filter((d) => d.version === version);
        return (
          <div key={version} className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-medium">Version {version}</p>
            <div className="flex flex-col gap-2">
              {versionDrafts.map((d) => {
                const evaluation = evaluationsByTargetId.get(d.id);
                const weighted = evaluation?.rubric_scores.weighted_score;
                return (
                  <div key={d.id} className="flex items-start justify-between gap-3 rounded bg-muted/40 p-2 text-xs">
                    <div>
                      <p className="font-medium">Option {d.option_number}</p>
                      {evaluation && <p className="mt-1 text-muted-foreground">{evaluation.notes || "No notes."}</p>}
                    </div>
                    {evaluation && (
                      <Badge variant={VERDICT_VARIANT[evaluation.overall_status]}>
                        {evaluation.overall_status}
                        {typeof weighted === "number" ? ` · ${weighted.toFixed(2)}/5` : ""}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
