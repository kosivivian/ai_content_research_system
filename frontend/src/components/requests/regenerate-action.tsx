"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/**
 * Enqueues a regenerate_article/regenerate_channel pipeline_jobs row
 * directly (RLS-permitted for the owning creator while awaiting_creator/
 * changes_requested -- see 20250101000019_regenerate.sql) and lets the
 * backend worker pick it up like any other job. Optional instructions are
 * folded into the AI prompt verbatim.
 */
export function RegenerateAction({
  requestId,
  stage,
  payload,
  label,
}: {
  requestId: string;
  stage: "regenerate_article" | "regenerate_channel";
  payload: Record<string, unknown>;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("pipeline_jobs").insert({
        request_id: requestId,
        stage,
        payload: instructions.trim() ? { ...payload, instructions: instructions.trim() } : payload,
      });
      if (insertError) throw new Error(insertError.message);
      setQueued(true);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (queued) {
    return <p className="text-xs text-muted-foreground">Regeneration queued -- refresh in a moment to see the result.</p>;
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <Textarea
        placeholder="Optional: what should change? (e.g. the approver's feedback) Leave blank to let the AI use its own judgment."
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        className="min-h-20 text-xs"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={submitting} onClick={submit}>
          {submitting ? "Queuing..." : "Regenerate"}
        </Button>
        <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
