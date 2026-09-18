import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/requests/status-badge";
import { ActivityTimeline } from "@/components/requests/activity-timeline";
import { ArticlePanel } from "@/components/requests/article-panel";
import type { CitedSource } from "@/components/requests/article-sources-tab";
import { ChannelDraftsView } from "@/components/requests/channel-drafts-view";
import { ApprovalActions } from "@/components/requests/approval-actions";
import { SendForApprovalButton } from "@/components/requests/send-for-approval-button";
import { ResubmitForm } from "@/components/requests/resubmit-form";
import { SchedulingPanel } from "@/components/requests/scheduling-panel";
import { RetryFailedStep } from "@/components/requests/retry-failed-step";
import { RealtimeRefresh } from "@/components/requests/realtime-refresh";
import { EvaluationBreakdown } from "@/components/requests/evaluation-breakdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ActivityLogEntry,
  Approval,
  ArticleDraft,
  ChannelDraft,
  ContentPlan,
  ContentRequest,
  Evaluation,
  PipelineJob,
  PublishingQueueItem,
  SourceMaterial,
} from "@/lib/types/db";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: requestData } = await supabase.from("content_requests").select("*").eq("id", id).single();
  if (!requestData) notFound();
  const request = requestData as ContentRequest;

  const [
    { data: articleDraftsData },
    { data: channelDraftsData },
    { data: activityData },
    { data: approvalsData },
    { data: publishingQueueData },
    { data: failedJobsData },
    { data: evaluationsData },
    { data: contentPlansData },
    { data: sourceMaterialsData },
  ] = await Promise.all([
    supabase
      .from("article_drafts")
      .select("*")
      .eq("request_id", id)
      .order("version", { ascending: false })
      .order("option_number", { ascending: true }),
    supabase
      .from("channel_drafts")
      .select("*")
      .eq("request_id", id)
      .order("version", { ascending: false })
      .order("channel", { ascending: true }),
    supabase.from("activity_log").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    supabase.from("approvals").select("*").eq("request_id", id).order("decided_at", { ascending: false }),
    supabase.from("publishing_queue").select("*").eq("request_id", id).order("created_at", { ascending: false }),
    supabase.from("pipeline_jobs").select("*").eq("request_id", id).eq("status", "failed"),
    // Every iteration, both article and channel evaluations -- powers the
    // revision-history tab as well as the "current" badge lookups below.
    supabase.from("evaluations").select("*").eq("request_id", id),
    supabase.from("content_plans").select("*").eq("request_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("source_materials").select("*").eq("request_id", id),
  ]);

  const allArticleDrafts = (articleDraftsData ?? []) as ArticleDraft[];
  const latestArticleVersion = allArticleDrafts[0]?.version;
  const latestArticleDrafts = allArticleDrafts.filter((d) => d.version === latestArticleVersion);

  const allChannelDrafts = (channelDraftsData ?? []) as ChannelDraft[];
  const latestChannelVersion = allChannelDrafts[0]?.version;
  const latestChannelDrafts = allChannelDrafts.filter((d) => d.version === latestChannelVersion);

  const evaluations = (evaluationsData ?? []) as Evaluation[];
  const evaluationsByTargetId = new Map(evaluations.map((e) => [e.target_id, e]));
  const articleEvaluations = evaluations.filter((e) => e.target_type === "article");

  const contentPlan = ((contentPlansData ?? []) as ContentPlan[])[0] ?? null;
  const sourceMaterials = (sourceMaterialsData ?? []) as SourceMaterial[];

  const activity = (activityData ?? []) as ActivityLogEntry[];
  const approvals = (approvalsData ?? []) as Approval[];
  const publishingQueue = (publishingQueueData ?? []) as PublishingQueueItem[];
  const failedJobs = (failedJobsData ?? []) as PipelineJob[];
  const canRetry = profile?.id === request.created_by || profile?.role === "approver";

  const brief = request.brief ?? {};
  const isIntakeBlocked =
    request.status === "awaiting_creator" &&
    ((brief.missing_fields?.length ?? 0) > 0 || (brief.blocked_sources?.length ?? 0) > 0);

  const bestArticleDraft =
    latestArticleDrafts.find((d) => evaluationsByTargetId.get(d.id)?.overall_status === "pass") ??
    latestArticleDrafts[0];

  const sourceMaterialsById = new Map(sourceMaterials.map((s) => [s.id, s]));
  const citedSources: CitedSource[] = (bestArticleDraft?.citations ?? [])
    .map((c) => sourceMaterialsById.get(c.source_material_id))
    .filter((s): s is SourceMaterial => Boolean(s))
    .map((s) => ({
      id: s.id,
      sourceUrl: s.source_url,
      excerpt: s.extracted_text ?? "",
      origin: s.origin,
    }));

  const channelEvaluations = latestChannelDrafts
    .map((d) => {
      const evaluation = evaluationsByTargetId.get(d.id);
      return evaluation ? { channel: d.channel, evaluation } : null;
    })
    .filter((v): v is { channel: ChannelDraft["channel"]; evaluation: Evaluation } => v !== null);

  const canEditDrafts =
    profile?.id === request.created_by &&
    !isIntakeBlocked &&
    (request.status === "awaiting_creator" || request.status === "changes_requested");

  const latestRejection = request.status === "changes_requested" ? approvals[0] : undefined;

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[1fr_320px]">
      <RealtimeRefresh requestId={request.id} />
      <div className="flex flex-col gap-6">
        <div>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">{brief.topic || request.raw_idea || "Untitled request"}</h1>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {brief.audience || request.target_audience || "No audience set"} &middot;{" "}
            {brief.tone || request.tone || "No tone set"}
          </p>
          {brief.overview && <p className="mt-3 text-sm">{brief.overview}</p>}
        </div>

        {canRetry &&
          failedJobs.map((job) => <RetryFailedStep key={job.id} jobId={job.id} stage={job.stage} />)}

        {latestRejection && (
          <Card className="border-danger/40">
            <CardHeader>
              <CardTitle className="text-base text-danger">Changes requested</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {latestRejection.comments || "The approver requested changes but didn't leave comments."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Edit the article or channel drafts below, then send for approval again.
              </p>
            </CardContent>
          </Card>
        )}

        {isIntakeBlocked && (
          <Card className="border-warning/40">
            <CardHeader>
              <CardTitle className="text-base text-warning">This request needs a fix before it can proceed</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {(brief.missing_fields?.length ?? 0) > 0 && (
                <p className="text-sm">Missing: {brief.missing_fields!.join(", ")}</p>
              )}
              {brief.blocked_sources?.map((s, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-3 text-sm">
                  <p className="font-medium">{s.source_url ?? "A supporting item"}</p>
                  <p className="text-muted-foreground">{s.reason}</p>
                  <p className="text-muted-foreground">Suggestion: {s.suggestion}</p>
                </div>
              ))}
              {profile?.id === request.created_by && <ResubmitForm request={request} />}
            </CardContent>
          </Card>
        )}

        {bestArticleDraft && (
          <ArticlePanel
            bestDraft={bestArticleDraft}
            evaluation={evaluationsByTargetId.get(bestArticleDraft.id)}
            editable={canEditDrafts}
            citedSources={citedSources}
            outline={contentPlan?.outline ?? null}
            allDrafts={allArticleDrafts}
            allEvaluations={articleEvaluations}
          />
        )}

        <ChannelDraftsView
          drafts={latestChannelDrafts}
          evaluationsByTargetId={evaluationsByTargetId}
          editable={canEditDrafts}
        />

        {(request.status === "awaiting_creator" || request.status === "changes_requested") &&
          !isIntakeBlocked &&
          profile?.id === request.created_by && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ready for approval?</CardTitle>
              </CardHeader>
              <CardContent>
                <SendForApprovalButton requestId={request.id} />
              </CardContent>
            </Card>
          )}

        {request.status === "awaiting_approval" && profile?.role === "approver" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your decision</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalActions requestId={request.id} approverId={profile.id} />
            </CardContent>
          </Card>
        )}

        {(request.status === "approved" || request.status === "scheduled") &&
          profile?.id === request.created_by && (
            <SchedulingPanel requestId={request.id} channelDrafts={latestChannelDrafts} queueItems={publishingQueue} />
          )}

        {approvals.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approval history</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {approvals.map((a) => (
                <div key={a.id} className="text-sm">
                  <span className="font-medium capitalize">{a.decision}</span> on{" "}
                  {new Date(a.decided_at).toLocaleString()}
                  {a.comments && <p className="text-muted-foreground">{a.comments}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
        <EvaluationBreakdown
          articleEvaluation={bestArticleDraft ? evaluationsByTargetId.get(bestArticleDraft.id) : undefined}
          channelEvaluations={channelEvaluations}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline entries={activity} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
