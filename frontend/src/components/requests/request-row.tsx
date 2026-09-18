import Link from "next/link";
import { StatusBadge } from "@/components/requests/status-badge";
import type { ContentRequest } from "@/lib/types/db";

function titleFor(request: Pick<ContentRequest, "brief" | "raw_idea">): string {
  return request.brief?.topic || request.raw_idea || "Untitled request";
}

export function RequestRow({ request }: { request: ContentRequest }) {
  return (
    <Link
      href={`/requests/${request.id}`}
      className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{titleFor(request)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {request.brief?.audience ?? request.target_audience ?? "No audience set"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {new Date(request.updated_at).toLocaleDateString()}
        </span>
        <StatusBadge status={request.status} />
      </div>
    </Link>
  );
}
