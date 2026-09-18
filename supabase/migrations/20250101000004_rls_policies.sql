-- =========================================================================
-- All pipeline writes (research, generation, evaluation, etc.) happen from
-- the backend using the Supabase service role key, which bypasses RLS
-- entirely. The policies below govern what the two human roles can see and
-- do directly from the frontend's authenticated Supabase client. Anything
-- not explicitly allowed here is denied by default (RLS default-deny).
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.content_requests enable row level security;
alter table public.source_materials enable row level security;
alter table public.research_queries enable row level security;
alter table public.reranked_sources enable row level security;
alter table public.content_plans enable row level security;
alter table public.article_drafts enable row level security;
alter table public.channel_drafts enable row level security;
alter table public.evaluations enable row level security;
alter table public.approvals enable row level security;
alter table public.publishing_queue enable row level security;
alter table public.activity_log enable row level security;
alter table public.error_logs enable row level security;
alter table public.pipeline_jobs enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- Account creation/deactivation is done by the backend via the Supabase
-- Admin API (service role), not by direct client insert, so there is
-- deliberately no insert policy here.
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select
  using (id = auth.uid() or app_role() = 'approver');

create policy profiles_update_approver_only on public.profiles
  for update
  using (app_role() = 'approver')
  with check (app_role() = 'approver');

-- ---------------------------------------------------------------------
-- content_requests
-- Creators own their own requests; approvers can read all of them but
-- write only through the approvals table (see below), never directly.
-- ---------------------------------------------------------------------
create policy content_requests_select on public.content_requests
  for select
  using (created_by = auth.uid() or app_role() = 'approver');

create policy content_requests_insert on public.content_requests
  for insert
  with check (created_by = auth.uid() and app_role() = 'creator' and is_active());

create policy content_requests_update_own on public.content_requests
  for update
  using (created_by = auth.uid() and app_role() = 'creator' and is_active())
  with check (created_by = auth.uid());

-- ---------------------------------------------------------------------
-- Per-request child tables: read-only for the owning creator or any
-- approver. The backend (service role) is the only writer.
-- ---------------------------------------------------------------------
create policy source_materials_select on public.source_materials
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = source_materials.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy research_queries_select on public.research_queries
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = research_queries.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy reranked_sources_select on public.reranked_sources
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = reranked_sources.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy content_plans_select on public.content_plans
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = content_plans.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy article_drafts_select on public.article_drafts
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = article_drafts.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy channel_drafts_select on public.channel_drafts
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = channel_drafts.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy evaluations_select on public.evaluations
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = evaluations.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

-- ---------------------------------------------------------------------
-- approvals: only an active approver may record a decision, and only on
-- a request that's actually awaiting approval. Creators can read
-- decisions on their own requests.
-- ---------------------------------------------------------------------
create policy approvals_select on public.approvals
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = approvals.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy approvals_insert on public.approvals
  for insert
  with check (
    approver_id = auth.uid()
    and app_role() = 'approver'
    and is_active()
    and exists (
      select 1 from public.content_requests cr
      where cr.id = approvals.request_id
        and cr.status = 'awaiting_approval'
    )
  );

-- ---------------------------------------------------------------------
-- publishing_queue: a creator may only queue a request that is already
-- approved -- enforced here, not just in the UI, per the "don't schedule
-- until approved" requirement.
-- ---------------------------------------------------------------------
create policy publishing_queue_select on public.publishing_queue
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = publishing_queue.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy publishing_queue_insert on public.publishing_queue
  for insert
  with check (exists (
    select 1 from public.content_requests cr
    where cr.id = publishing_queue.request_id
      and cr.created_by = auth.uid()
      and app_role() = 'creator'
      and is_active()
      and cr.status = 'approved'
  ));

-- ---------------------------------------------------------------------
-- activity_log: readable by request owner/approver. Humans may log their
-- own actions directly (e.g. "requested regeneration of section X");
-- system/ai_agent entries are only ever written by the backend.
-- ---------------------------------------------------------------------
create policy activity_log_select on public.activity_log
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = activity_log.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));

create policy activity_log_insert_human on public.activity_log
  for insert
  with check (
    actor_type in ('creator', 'approver')
    and actor_id = auth.uid()
    and exists (
      select 1 from public.content_requests cr
      where cr.id = activity_log.request_id
        and (cr.created_by = auth.uid() or app_role() = 'approver')
    )
  );

-- ---------------------------------------------------------------------
-- error_logs: visible to the request owner and any approver; only an
-- approver may mark one resolved.
-- ---------------------------------------------------------------------
create policy error_logs_select on public.error_logs
  for select
  using (
    app_role() = 'approver'
    or exists (
      select 1 from public.content_requests cr
      where cr.id = error_logs.request_id
        and cr.created_by = auth.uid()
    )
  );

create policy error_logs_update_approver_only on public.error_logs
  for update
  using (app_role() = 'approver')
  with check (app_role() = 'approver');

-- ---------------------------------------------------------------------
-- pipeline_jobs: internal queue, visible for debugging to the request
-- owner and approvers; no direct client writes.
-- ---------------------------------------------------------------------
create policy pipeline_jobs_select on public.pipeline_jobs
  for select
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = pipeline_jobs.request_id
      and (cr.created_by = auth.uid() or app_role() = 'approver')
  ));
