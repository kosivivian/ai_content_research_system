import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface CitedSource {
  id: string;
  sourceUrl: string | null;
  excerpt: string;
  origin: string;
}

const ORIGIN_LABEL: Record<string, string> = {
  user_upload: "Uploaded",
  user_url: "Your link",
  research_result: "Research",
};

/** Every source the current best article draft actually cites, each a real clickable link when it has one. */
export function ArticleSourcesTab({ sources }: { sources: CitedSource[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">This draft doesn&apos;t cite any sources yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sources.map((s, i) => (
        <Card key={s.id}>
          <CardContent className="flex flex-col gap-1 pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Source {i + 1}</span>
              <Badge variant="default">{ORIGIN_LABEL[s.origin] ?? s.origin}</Badge>
            </div>
            {s.sourceUrl ? (
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm text-primary underline underline-offset-2 hover:opacity-80"
              >
                {s.sourceUrl}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">Pasted text (no URL)</p>
            )}
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{s.excerpt}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
