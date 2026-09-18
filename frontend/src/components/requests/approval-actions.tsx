"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function ApprovalActions({ requestId, approverId }: { requestId: string; approverId: string }) {
  const router = useRouter();
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setError(null);
    setSubmitting(decision);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("approvals").insert({
        request_id: requestId,
        approver_id: approverId,
        decision,
        comments: comments.trim() || null,
      });
      if (insertError) throw new Error(insertError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        placeholder="Comments (shown to the creator, especially useful if you're rejecting)"
        value={comments}
        onChange={(e) => setComments(e.target.value)}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="success" disabled={submitting !== null} onClick={() => decide("approved")}>
          {submitting === "approved" ? "Approving..." : "Approve"}
        </Button>
        <Button variant="destructive" disabled={submitting !== null} onClick={() => decide("rejected")}>
          {submitting === "rejected" ? "Rejecting..." : "Request changes"}
        </Button>
      </div>
    </div>
  );
}
