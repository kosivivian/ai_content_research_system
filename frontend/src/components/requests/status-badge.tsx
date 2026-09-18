import { Loader2 } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { ContentRequestStatus } from "@/lib/types/db";

const STATUS_META: Record<ContentRequestStatus, { label: string; variant: BadgeProps["variant"] }> = {
  intake: { label: "Intake", variant: "default" },
  researching: { label: "Researching", variant: "primary" },
  retrieving: { label: "Retrieving", variant: "primary" },
  reranking: { label: "Ranking sources", variant: "primary" },
  planning: { label: "Planning", variant: "primary" },
  generating: { label: "Drafting", variant: "primary" },
  evaluating: { label: "Evaluating", variant: "primary" },
  awaiting_creator: { label: "Needs your review", variant: "warning" },
  awaiting_approval: { label: "Awaiting approval", variant: "warning" },
  changes_requested: { label: "Changes requested", variant: "danger" },
  approved: { label: "Approved", variant: "success" },
  scheduled: { label: "Scheduled", variant: "success" },
  published: { label: "Published", variant: "success" },
  errored: { label: "Error", variant: "danger" },
};

/** Statuses where the backend worker is actively doing something right now -- matches QueueSummary's "In progress" bucket. Everything else is either waiting on a human or a terminal state. */
const IN_PROGRESS_STATUSES: ContentRequestStatus[] = [
  "intake",
  "researching",
  "retrieving",
  "reranking",
  "planning",
  "generating",
  "evaluating",
];

export function StatusBadge({ status }: { status: ContentRequestStatus }) {
  const meta = STATUS_META[status] ?? { label: status, variant: "default" as const };
  const inProgress = IN_PROGRESS_STATUSES.includes(status);
  return (
    <Badge variant={meta.variant} className="gap-1">
      {inProgress && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      {meta.label}
    </Badge>
  );
}
