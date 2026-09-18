"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ErrorLogEntry } from "@/lib/types/db";

export function ErrorRow({ entry }: { entry: ErrorLogEntry }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function markResolved() {
    setSubmitting(true);
    const supabase = createClient();
    await supabase.from("error_logs").update({ resolved: true }).eq("id", entry.id);
    router.refresh();
  }

  return (
    <div className="rounded-md border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{entry.stage}</p>
          <p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={entry.resolved ? "success" : "danger"}>{entry.resolved ? "Resolved" : "Open"}</Badge>
          {!entry.resolved && (
            <Button size="sm" variant="outline" disabled={submitting} onClick={markResolved}>
              Mark resolved
            </Button>
          )}
        </div>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2 text-xs">
        {JSON.stringify(entry.detail, null, 2)}
      </pre>
      {entry.request_id && (
        <Link href={`/requests/${entry.request_id}`} className="mt-2 inline-block text-xs text-primary underline">
          View request
        </Link>
      )}
    </div>
  );
}
