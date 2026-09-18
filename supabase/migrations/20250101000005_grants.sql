-- Base table privileges. Supabase projects normally grant these by default,
-- but we set them explicitly so this schema is self-contained and doesn't
-- rely on platform defaults. RLS policies (previous migration) are what
-- actually restrict rows -- these grants just allow the verbs a role is
-- ever permitted to attempt.

grant usage on schema public to authenticated, service_role;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.content_requests to authenticated;

grant select on public.source_materials to authenticated;
grant select on public.research_queries to authenticated;
grant select on public.reranked_sources to authenticated;
grant select on public.content_plans to authenticated;
grant select on public.article_drafts to authenticated;
grant select on public.channel_drafts to authenticated;
grant select on public.evaluations to authenticated;

grant select, insert on public.approvals to authenticated;
grant select, insert on public.publishing_queue to authenticated;
grant select, insert on public.activity_log to authenticated;
grant select, update on public.error_logs to authenticated;
grant select on public.pipeline_jobs to authenticated;

-- The backend worker's service role bypasses RLS but still needs grants.
grant all on all tables in schema public to service_role;

-- So future migrations' new tables inherit sane grants automatically.
alter default privileges in schema public
  grant select on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
