"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown to the owning creator or any approver when a pipeline_jobs row for
 * this request is stuck at 'failed' -- retries just that stage via the
 * retry_pipeline_job() RPC (migration 20250101000015) rather than making
 * anyone resubmit the whole request from intake. Authorization (owner
 * creator OR any active approver) is enforced in the RPC itself, not just
 * by hiding this button.
 */
export function RetryFailedStep({ jobId, stage }: { jobId: string; stage: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("retry_pipeline_job", { p_job_id: jobId });
      if (rpcError) throw new Error(rpcError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle className="text-base text-danger">This request got stuck</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          The <span className="font-medium">{stage.replace(/_/g, " ")}</span> step failed and ran out of retries.
          You can retry just this step instead of starting the request over.
        </p>
        <Button variant="outline" size="sm" disabled={submitting} onClick={retry} className="w-fit">
          {submitting ? "Retrying..." : "Retry this step"}
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
