\set ON_ERROR_STOP off

insert into auth.users (id, email) values
  ('dd111111-1111-1111-1111-111111111111', 'regen-creator@test.com')
on conflict (id) do nothing;

insert into public.content_requests (id, created_by, raw_idea, status) values
  ('dd222222-2222-2222-2222-222222222222', 'dd111111-1111-1111-1111-111111111111', 'regen test request', 'awaiting_creator')
on conflict (id) do nothing;

delete from public.pipeline_jobs where request_id = 'dd222222-2222-2222-2222-222222222222';

-- 1. Owning creator can insert a regenerate_article job while awaiting_creator.
begin;
set role authenticated;
set local request.jwt.claim.sub = 'dd111111-1111-1111-1111-111111111111';
insert into public.pipeline_jobs (request_id, stage, payload) values
  ('dd222222-2222-2222-2222-222222222222', 'regenerate_article', '{"articleDraftId": "x"}'::jsonb);
reset role;
commit;
select 'regenerate_article inserted (expect 1 row, status queued, attempts 0)' as label, status, attempt_count
from public.pipeline_jobs where request_id = 'dd222222-2222-2222-2222-222222222222' and stage = 'regenerate_article';

-- 2. Cannot insert an arbitrary stage this way (e.g. sneaking in 'intake' to
-- force a full pipeline restart) -- should FAIL.
begin;
set role authenticated;
set local request.jwt.claim.sub = 'dd111111-1111-1111-1111-111111111111';
savepoint sp1;
insert into public.pipeline_jobs (request_id, stage, payload) values
  ('dd222222-2222-2222-2222-222222222222', 'intake', '{}'::jsonb);
rollback to savepoint sp1;
reset role;
commit;
select 'arbitrary stage blocked (expect 0)' as label, count(*)
from public.pipeline_jobs where request_id = 'dd222222-2222-2222-2222-222222222222' and stage = 'intake';

-- 3. Cannot set status/attempt_count directly on insert -- column-level
-- grant means this fails outright, not just gets ignored.
begin;
set role authenticated;
set local request.jwt.claim.sub = 'dd111111-1111-1111-1111-111111111111';
savepoint sp2;
insert into public.pipeline_jobs (request_id, stage, payload, status) values
  ('dd222222-2222-2222-2222-222222222222', 'regenerate_channel', '{"channelDraftId": "x"}'::jsonb, 'done');
rollback to savepoint sp2;
reset role;
commit;
select 'status column still protected (expect 0 regenerate_channel rows)' as label, count(*)
from public.pipeline_jobs where request_id = 'dd222222-2222-2222-2222-222222222222' and stage = 'regenerate_channel';

-- 4. Once approved, the creator can no longer enqueue a regenerate job.
update public.content_requests set status = 'approved' where id = 'dd222222-2222-2222-2222-222222222222';

begin;
set role authenticated;
set local request.jwt.claim.sub = 'dd111111-1111-1111-1111-111111111111';
savepoint sp3;
insert into public.pipeline_jobs (request_id, stage, payload) values
  ('dd222222-2222-2222-2222-222222222222', 'regenerate_channel', '{"channelDraftId": "x"}'::jsonb);
rollback to savepoint sp3;
reset role;
commit;
select 'blocked once approved (expect 0 regenerate_channel rows)' as label, count(*)
from public.pipeline_jobs where request_id = 'dd222222-2222-2222-2222-222222222222' and stage = 'regenerate_channel';
