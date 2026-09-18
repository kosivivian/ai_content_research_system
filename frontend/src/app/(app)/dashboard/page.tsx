import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { HeroAccent } from "@/components/dashboard/hero-accent";
import { QueueSummary } from "@/components/dashboard/queue-summary";
import { RequestRow } from "@/components/requests/request-row";
import { buttonVariants } from "@/components/ui/button";
import type { ContentRequest } from "@/lib/types/db";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  // RLS scopes this automatically: a creator only ever sees their own
  // requests, an approver sees every request.
  const { data } = await supabase
    .from("content_requests")
    .select("*")
    .order("updated_at", { ascending: false });

  const requests = (data ?? []) as ContentRequest[];

  const { count: openErrorCount } =
    profile?.role === "approver"
      ? await supabase.from("error_logs").select("*", { count: "exact", head: true }).eq("resolved", false)
      : { count: null };

  const needsAttention =
    profile?.role === "approver"
      ? requests.filter((r) => r.status === "awaiting_approval")
      : requests.filter((r) => r.status === "awaiting_creator" || r.status === "changes_requested");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card px-6 py-8">
        <HeroAccent />
        <h1 className="text-2xl font-semibold">Welcome back{profile ? `, ${profile.email.split("@")[0]}` : ""}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile?.role === "approver"
            ? "Review and approve content before it goes out."
            : "Track your content requests from idea to published post."}
        </p>
        {profile?.role === "creator" && (
          <Link href="/requests/new" className={buttonVariants({ className: "mt-4" })}>
            New request
          </Link>
        )}
      </div>

      <QueueSummary statuses={requests.map((r) => r.status)} />

      {profile?.role === "approver" && (openErrorCount ?? 0) > 0 && (
        <Link
          href="/errors"
          className="mt-4 flex items-center justify-between rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm transition-colors hover:bg-danger/10"
        >
          <span className="font-medium text-danger">
            {openErrorCount} open error{openErrorCount === 1 ? "" : "s"} need attention
          </span>
          <span className="text-xs text-danger underline">View error log</span>
        </Link>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          {profile?.role === "approver" ? "Awaiting your approval" : "Needs your attention"}
        </h2>
        {needsAttention.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here right now.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {needsAttention.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">All requests</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content requests yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
