\set ON_ERROR_STOP off

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'retry-owner-creator@test.com'),
  ('99999999-9999-9999-9999-999999999999', 'retry-other-creator@test.com'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'retry-approver@test.com')
on conflict (id) do nothing;

update public.profiles set role = 'approver' where id = 'aaaaaaaa-1111-1111-1111-111111111111';

insert into public.content_requests (id, created_by, raw_idea, status) values
  ('bbbbbbbb-2222-2222-2222-222222222222', '88888888-8888-8888-8888-888888888888', 'retry test request', 'errored')
on conflict (id) do nothing;

insert into public.pipeline_jobs (id, request_id, stage, status, attempt_count) values
  ('cccccccc-3333-3333-3333-333333333333', 'bbbbbbbb-2222-2222-2222-222222222222', 'research', 'failed', 3)
on conflict (id) do nothing;

-- 1. A different creator (doesn't own the request) cannot retry it.
begin;
set role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
savepoint sp1;
select retry_pipeline_job('cccccccc-3333-3333-3333-333333333333');
rollback to savepoint sp1;
reset role;
commit;
select 'non-owner creator blocked (expect failed, attempt 3)' as label, status, attempt_count
from public.pipeline_jobs where id = 'cccccccc-3333-3333-3333-333333333333';

-- 2. The owning creator can retry -- status resets to queued, attempt_count to 0.
begin;
set role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
select retry_pipeline_job('cccccccc-3333-3333-3333-333333333333');
reset role;
commit;
select 'owning creator retry (expect queued, attempt 0)' as label, status, attempt_count
from public.pipeline_jobs where id = 'cccccccc-3333-3333-3333-333333333333';

-- 3. Retrying a job that isn't 'failed' anymore (it's 'queued' now) is rejected.
begin;
set role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
savepoint sp2;
select retry_pipeline_job('cccccccc-3333-3333-3333-333333333333');
rollback to savepoint sp2;
reset role;
commit;
select 'retry on non-failed job blocked (expect queued, attempt 0)' as label, status, attempt_count
from public.pipeline_jobs where id = 'cccccccc-3333-3333-3333-333333333333';

-- 4. An approver can retry any failed job, even one they don't own.
update public.pipeline_jobs set status = 'failed', attempt_count = 3
  where id = 'cccccccc-3333-3333-3333-333333333333';

begin;
set role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-1111-1111-1111-111111111111';
select retry_pipeline_job('cccccccc-3333-3333-3333-333333333333');
reset role;
commit;
select 'approver retry (expect queued, attempt 0)' as label, status, attempt_count
from public.pipeline_jobs where id = 'cccccccc-3333-3333-3333-333333333333';
