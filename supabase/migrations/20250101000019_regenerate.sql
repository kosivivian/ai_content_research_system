-- Targeted regeneration: the creator can ask for just the article, or just
-- one channel, to be redone -- instead of the only options being "hand-edit
-- it yourself" (20250101000018) or "resubmit the whole request from
-- intake" (which reruns the entire pipeline). This reuses the existing
-- pipeline_jobs queue/worker rather than a new HTTP endpoint, so it gets
-- retries and error-log visibility for free -- the creator just inserts a
-- job directly (same pattern as content_requests/approvals/
-- publishing_queue), the worker picks it up like any other job.

-- Generic per-job parameters (which draft/channel, optional instructions).
-- Existing stages don't use this; only regenerate_article/regenerate_channel
-- do.
alter table public.pipeline_jobs add column payload jsonb not null default '{}'::jsonb;

-- Column-level grant: the client can only ever set request_id/stage/payload
-- on insert -- status, attempt_count, id, and the timestamps all fall back
-- to their table defaults (status='queued', attempt_count=0, etc.),
-- regardless of what a client tries to send.
grant insert (request_id, stage, payload) on public.pipeline_jobs to authenticated;

create policy pipeline_jobs_insert_regenerate on public.pipeline_jobs
  for insert
  with check (
    stage in ('regenerate_article', 'regenerate_channel')
    and exists (
      select 1 from public.content_requests cr
      where cr.id = pipeline_jobs.request_id
        and cr.created_by = auth.uid()
        and app_role() = 'creator'
        and is_active()
        and cr.status in ('awaiting_creator', 'changes_requested')
    )
  );
