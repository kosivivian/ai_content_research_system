"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Renders nothing -- just keeps the request page's server-fetched data live.
 * Without this, the page only re-fetches after a button the viewer
 * themselves clicked (approve/schedule/retry); it never reflects the
 * backend worker progressing through the pipeline in the background while
 * someone is just sitting on the page. Requires the tables to be added to
 * the `supabase_realtime` publication (see migration 20250101000016).
 */
export function RealtimeRefresh({ requestId }: { requestId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`request-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "content_requests", filter: `id=eq.${requestId}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log", filter: `request_id=eq.${requestId}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "error_logs", filter: `request_id=eq.${requestId}` },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, router]);

  return null;
}
