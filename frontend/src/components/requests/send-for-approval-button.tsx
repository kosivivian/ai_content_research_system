"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SendForApprovalButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("content_requests")
        .update({ status: "awaiting_approval" })
        .eq("id", requestId);
      if (updateError) throw new Error(updateError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleClick} disabled={submitting}>
        {submitting ? "Sending..." : "Send for approval"}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
