import { Badge } from "@/components/ui/badge";
import type { Outline } from "@/lib/types/db";

/**
 * The plan stage's schema marks these fields required arrays, but forced
 * tool-use is reliable, not guaranteed -- channel_adapt has already shown
 * the model can deviate from a schema in ways that only surface as a
 * runtime crash several steps later. Coerce defensively here rather than
 * assume the stored jsonb always matches the TypeScript type exactly.
 */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/** Read-only view of the outline the plan stage produced -- what generate was actually told to follow. */
export function ArticleOutlineTab({ outline }: { outline: Outline | null }) {
  if (!outline) {
    return <p className="text-sm text-muted-foreground">No outline yet -- this request hasn&apos;t reached planning.</p>;
  }

  const secondaryKeywords = asStringArray(outline.secondary_keywords);
  const sections = Array.isArray(outline.sections) ? outline.sections : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Title</p>
        <p className="text-sm">{outline.title}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Hook</p>
        <p className="text-sm">{outline.hook}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {outline.primary_keyword && <Badge variant="primary">{outline.primary_keyword}</Badge>}
        {secondaryKeywords.map((k) => (
          <Badge key={k} variant="default">
            {k}
          </Badge>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {sections.map((section, i) => (
          <div key={i} className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              {section.level === "h2" ? "H2" : "H3"} &middot; {section.heading}
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {asStringArray(section.key_points).map((p, j) => (
                <li key={j}>{p}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Call to action</p>
        <p className="text-sm">{outline.cta}</p>
      </div>
    </div>
  );
}
