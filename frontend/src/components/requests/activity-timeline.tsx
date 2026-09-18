import type { ActivityLogEntry } from "@/lib/types/db";

const ACTOR_LABEL: Record<ActivityLogEntry["actor_type"], string> = {
  system: "System",
  ai_agent: "AI",
  creator: "Creator",
  approver: "Approver",
};

function summarize(entry: ActivityLogEntry): string | null {
  const d = entry.detail;
  if (entry.action === "brief_generated") return d.complete ? "Brief looks complete." : "Brief needs attention.";
  if (entry.action === "research_completed") return `${d.sourcesFound ?? 0} source(s) found${d.degraded ? " (degraded)" : ""}.`;
  if (entry.action === "retrieval_completed") return `${d.embedded ?? 0} source(s) embedded.`;
  if (entry.action === "sources_reranked") return `${d.selected ?? 0} of ${d.candidates ?? 0} candidates selected.`;
  if (entry.action === "draft_generated") return `Draft v${d.version}${d.isRevision ? " (revision)" : ""}, ${d.optionCount} option(s).`;
  if (entry.action === "article_evaluated")
    return `v${d.version}: ${d.overallStatus}${d.needsManualAttention ? " -- needs manual attention" : ""}`;
  if (entry.action === "channel_drafts_generated") return `Channel drafts v${d.version}${d.isRevision ? " (revision)" : ""}.`;
  if (entry.action === "channel_drafts_evaluated")
    return `${d.needsManualAttention ? "Needs manual attention. " : ""}${JSON.stringify(d.results ?? [])}`;
  return null;
}

export function ActivityTimeline({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 border-border pl-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{ACTOR_LABEL[entry.actor_type]}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(entry.created_at).toLocaleString()}
            </span>
          </div>
          <p className="text-sm">{entry.action.replace(/_/g, " ")}</p>
          {summarize(entry) && <p className="text-xs text-muted-foreground">{summarize(entry)}</p>}
        </li>
      ))}
    </ol>
  );
}
