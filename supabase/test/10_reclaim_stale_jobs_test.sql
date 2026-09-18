\set ON_ERROR_STOP off

insert into auth.users (id, email) values
  ('bb111111-1111-1111-1111-111111111111', 'reclaim-test-creator@test.com')
on conflict (id) do nothing;

insert into public.content_requests (id, created_by, raw_idea) values
  ('bb222222-2222-2222-2222-222222222222', 'bb111111-1111-1111-1111-111111111111', 'reclaim test request')
on conflict (id) do nothing;

-- The content_requests insert above auto-enqueues an 'intake' job (see
-- 20250101000008_intake_trigger.sql) -- not what this test is exercising,
-- so clear it before setting up the fixtures below.
delete from public.pipeline_jobs where request_id = 'bb222222-2222-2222-2222-222222222222';

-- A job stuck 'running' for 10 minutes (worker died mid-flight) -- should
-- be reclaimable. Inserted directly with a backdated updated_at since the
-- set_updated_at trigger only fires on UPDATE, not INSERT.
insert into public.pipeline_jobs (id, request_id, stage, status, attempt_count, created_at, updated_at) values
  ('bb333333-3333-3333-3333-333333333333', 'bb222222-2222-2222-2222-222222222222', 'research', 'running', 1,
   now() - interval '15 minutes', now() - interval '10 minutes')
on conflict (id) do nothing;

-- A job that's only been 'running' for 30 seconds -- still legitimately in
-- flight, must NOT be reclaimed.
insert into public.pipeline_jobs (id, request_id, stage, status, attempt_count, created_at, updated_at) values
  ('bb444444-4444-4444-4444-444444444444', 'bb222222-2222-2222-2222-222222222222', 'plan', 'running', 1,
   now() - interval '35 seconds', now() - interval '30 seconds')
on conflict (id) do nothing;

select claim_next_pipeline_job();

select 'stale running job reclaimed (expect running, attempt 2)' as label, status, attempt_count
from public.pipeline_jobs where id = 'bb333333-3333-3333-3333-333333333333';

select 'fresh running job untouched (expect running, attempt 1)' as label, status, attempt_count
from public.pipeline_jobs where id = 'bb444444-4444-4444-4444-444444444444';

-- A second claim call now finds nothing else claimable (the fresh running
-- job isn't stale yet, and there's no queued row) -- confirms this didn't
-- also just start claiming every running job indiscriminately.
select claim_next_pipeline_job();
