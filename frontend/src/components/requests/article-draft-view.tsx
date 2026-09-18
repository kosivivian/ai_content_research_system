"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownBody } from "@/components/requests/markdown-body";
import { RegenerateAction } from "@/components/requests/regenerate-action";
import type { ArticleDraft, Evaluation } from "@/lib/types/db";

const VERDICT_VARIANT = {
  pass: "success",
  revise: "warning",
  reject: "danger",
} as const;

export function ArticleDraftView({
  draft,
  evaluation,
  editable,
}: {
  draft: ArticleDraft;
  evaluation: Evaluation | undefined;
  /** Owning creator, while the request is awaiting_creator/changes_requested -- enforced again by RLS, this just controls whether the edit/regenerate UI renders. */
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body_markdown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("article_drafts")
        .update({ body_markdown: body })
        .eq("id", draft.id);
      if (updateError) throw new Error(updateError.message);

      await supabase.from("activity_log").insert({
        request_id: draft.request_id,
        actor_type: "creator",
        actor_id: (await supabase.auth.getUser()).data.user?.id,
        action: "article_draft_edited",
        detail: { articleDraftId: draft.id },
      });

      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const weightedScore = evaluation?.rubric_scores.weighted_score;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          Article draft (v{draft.version}, option {draft.option_number})
        </CardTitle>
        <div className="flex items-center gap-2">
          {evaluation && (
            <Badge variant={VERDICT_VARIANT[evaluation.overall_status]}>
              {evaluation.overall_status}
              {typeof weightedScore === "number" ? ` · ${weightedScore.toFixed(2)}/5` : ""}
            </Badge>
          )}
          {editable && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-64 font-mono text-xs"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={save}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setBody(draft.body_markdown);
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <MarkdownBody text={body} />
        )}

        {draft.citations.length > 0 && (
          <p className="text-xs text-muted-foreground">Cites {draft.citations.length} source(s) -- see the Sources tab.</p>
        )}

        {evaluation && (
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">Evaluation notes</p>
            <p>{evaluation.notes || "No notes."}</p>
            {evaluation.rubric_scores.weak_claims?.length > 0 && (
              <p className="mt-1 text-danger">Weak claims: {evaluation.rubric_scores.weak_claims.join("; ")}</p>
            )}
          </div>
        )}

        {editable && !editing && (
          <RegenerateAction
            requestId={draft.request_id}
            stage="regenerate_article"
            payload={{ articleDraftId: draft.id }}
            label="Regenerate this article"
          />
        )}
      </CardContent>
    </Card>
  );
}
