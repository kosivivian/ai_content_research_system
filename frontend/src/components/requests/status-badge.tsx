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

export function StatusBadge({ status }: { status: ContentRequestStatus }) {
  const meta = STATUS_META[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
