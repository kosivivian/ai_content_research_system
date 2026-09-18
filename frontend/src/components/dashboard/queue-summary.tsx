import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContentRequestStatus } from "@/lib/types/db";

const BUCKETS: { label: string; statuses: ContentRequestStatus[] }[] = [
  {
    label: "In progress",
    statuses: ["intake", "researching", "retrieving", "reranking", "planning", "generating", "evaluating"],
  },
  { label: "Needs review", statuses: ["awaiting_creator", "changes_requested"] },
  { label: "Awaiting approval", statuses: ["awaiting_approval"] },
  { label: "Ready to schedule", statuses: ["approved"] },
  { label: "Scheduled", statuses: ["scheduled"] },
  { label: "Published", statuses: ["published"] },
  { label: "Errored", statuses: ["errored"] },
];

export function QueueSummary({ statuses }: { statuses: ContentRequestStatus[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {BUCKETS.map((bucket) => {
        const count = statuses.filter((s) => bucket.statuses.includes(s)).length;
        return (
          <Card key={bucket.label}>
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-2xl">{count}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-xs text-muted-foreground">{bucket.label}</CardContent>
          </Card>
        );
      })}
    </div>
  );
}
