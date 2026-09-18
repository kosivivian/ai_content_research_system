"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types/db";

export function AccountRow({ account, isSelf }: { account: Profile; isSelf: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ active: !account.active })
        .eq("id", account.id);
      if (updateError) throw new Error(updateError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {account.email} {isSelf && <span className="text-muted-foreground">(you)</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          Joined {new Date(account.created_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge variant="primary" className="capitalize">
          {account.role}
        </Badge>
        <Badge variant={account.active ? "success" : "danger"}>{account.active ? "Active" : "Deactivated"}</Badge>
        {!isSelf && (
          <Button variant="outline" size="sm" disabled={submitting} onClick={toggleActive}>
            {account.active ? "Deactivate" : "Reactivate"}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
