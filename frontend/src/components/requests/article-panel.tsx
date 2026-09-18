import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArticleDraftView } from "@/components/requests/article-draft-view";
import { ArticleSourcesTab, type CitedSource } from "@/components/requests/article-sources-tab";
import { ArticleOutlineTab } from "@/components/requests/article-outline-tab";
import { ArticleRevisionHistoryTab } from "@/components/requests/article-revision-history-tab";
import type { ArticleDraft, Evaluation, Outline } from "@/lib/types/db";

export function ArticlePanel({
  bestDraft,
  evaluation,
  editable,
  citedSources,
  outline,
  allDrafts,
  allEvaluations,
}: {
  bestDraft: ArticleDraft;
  evaluation: Evaluation | undefined;
  editable: boolean;
  citedSources: CitedSource[];
  outline: Outline | null;
  allDrafts: ArticleDraft[];
  allEvaluations: Evaluation[];
}) {
  return (
    <Tabs defaultValue="draft">
      <TabsList>
        <TabsTrigger value="draft">Article</TabsTrigger>
        <TabsTrigger value="sources">Sources ({citedSources.length})</TabsTrigger>
        <TabsTrigger value="outline">Outline</TabsTrigger>
        <TabsTrigger value="history">Revision history</TabsTrigger>
      </TabsList>

      <TabsContent value="draft">
        <ArticleDraftView draft={bestDraft} evaluation={evaluation} editable={editable} />
      </TabsContent>

      <TabsContent value="sources">
        <ArticleSourcesTab sources={citedSources} />
      </TabsContent>

      <TabsContent value="outline">
        <ArticleOutlineTab outline={outline} />
      </TabsContent>

      <TabsContent value="history">
        <ArticleRevisionHistoryTab drafts={allDrafts} evaluations={allEvaluations} />
      </TabsContent>
    </Tabs>
  );
}
