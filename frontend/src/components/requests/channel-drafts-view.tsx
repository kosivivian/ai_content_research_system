"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownBody } from "@/components/requests/markdown-body";
import { RegenerateAction } from "@/components/requests/regenerate-action";
import type { ChannelDraft, Evaluation } from "@/lib/types/db";

const CHANNEL_LABEL: Record<ChannelDraft["channel"], string> = {
  linkedin: "LinkedIn",
  x: "X",
  email: "Email newsletter",
};

const VERDICT_VARIANT = {
  pass: "success",
  revise: "warning",
  reject: "danger",
} as const;

function ChannelDraftCard({
  draft,
  evaluation,
  editable,
}: {
  draft: ChannelDraft;
  evaluation: Evaluation | undefined;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.from("channel_drafts").update({ body }).eq("id", draft.id);
      if (updateError) throw new Error(updateError.message);

      await supabase.from("activity_log").insert({
        request_id: draft.request_id,
        actor_type: "creator",
        actor_id: (await supabase.auth.getUser()).data.user?.id,
        action: "channel_draft_edited",
        detail: { channelDraftId: draft.id, channel: draft.channel },
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
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center justify-between gap-2">
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

        {editing ? (
          <>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-48 font-mono text-xs" />
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={save}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setBody(draft.body);
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <MarkdownBody text={body} />
        )}

        {evaluation && (
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">Evaluation notes</p>
            <p>{evaluation.notes || "No notes."}</p>
          </div>
        )}

        {editable && !editing && (
          <RegenerateAction
            requestId={draft.request_id}
            stage="regenerate_channel"
            payload={{ channelDraftId: draft.id }}
            label={`Regenerate ${CHANNEL_LABEL[draft.channel]}`}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ChannelDraftsView({
  drafts,
  evaluationsByTargetId,
  editable,
}: {
  drafts: ChannelDraft[];
  evaluationsByTargetId: Map<string, Evaluation>;
  editable: boolean;
}) {
  if (drafts.length === 0) return null;

  return (
    <Tabs defaultValue={drafts[0]!.channel}>
      <TabsList>
        {drafts.map((draft) => (
          <TabsTrigger key={draft.id} value={draft.channel}>
            {CHANNEL_LABEL[draft.channel]}
          </TabsTrigger>
        ))}
      </TabsList>
      {drafts.map((draft) => (
        <TabsContent key={draft.id} value={draft.channel}>
          <ChannelDraftCard draft={draft} evaluation={evaluationsByTargetId.get(draft.id)} editable={editable} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
