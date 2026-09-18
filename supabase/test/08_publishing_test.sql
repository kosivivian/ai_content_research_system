\set ON_ERROR_STOP off

-- Earlier test files (01_rls_smoke_test.sql) leave their own publishing_queue
-- row behind when this harness is run cumulatively in one container; wipe it
-- so claim_next_publishing_item()'s oldest-first ordering is deterministic
-- against only this file's rows. Safe here since this is a throwaway test
-- database, not a real project.
delete from public.publishing_queue;

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'publishing-creator@test.com')
on conflict (id) do nothing;

insert into public.content_requests (id, created_by, raw_idea, status) values
  ('12121212-1212-1212-1212-121212121212', '77777777-7777-7777-7777-777777777777', 'req approved', 'approved'),
  ('34343434-3434-3434-3434-343434343434', '77777777-7777-7777-7777-777777777777', 'req awaiting_approval', 'awaiting_approval')
on conflict (id) do nothing;

-- 1. Creator can queue the first channel for an approved request -- should
-- SUCCEED and flip content_requests.status to 'scheduled'.
begin;
set role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
insert into public.publishing_queue (id, request_id, channel, scheduled_time) values
  ('aa111111-1111-1111-1111-111111111111', '12121212-1212-1212-1212-121212121212', 'linkedin', now() + interval '1 day');
reset role;
commit;
select 'after 1st channel queued (expect scheduled)' as label, status
from public.content_requests where id = '12121212-1212-1212-1212-121212121212';

-- 2. Creator can queue a 2nd channel even though the request is now
-- 'scheduled' rather than 'approved' -- should SUCCEED (the widened policy).
begin;
set role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
insert into public.publishing_queue (id, request_id, channel, scheduled_time) values
  ('aa222222-2222-2222-2222-222222222222', '12121212-1212-1212-1212-121212121212', 'x', now() + interval '1 day');
reset role;
commit;
select '2nd channel queue attempt (expect 2 rows)' as label, count(*)
from public.publishing_queue where request_id = '12121212-1212-1212-1212-121212121212';

-- 3. Creator cannot queue publishing for a request that's not yet approved
-- -- should FAIL.
begin;
set role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
savepoint sp1;
insert into public.publishing_queue (id, request_id, channel) values
  ('aa333333-3333-3333-3333-333333333333', '34343434-3434-3434-3434-343434343434', 'linkedin');
rollback to savepoint sp1;
reset role;
commit;
select 'not-yet-approved queue attempt blocked (expect 0)' as label, count(*)
from public.publishing_queue where id = 'aa333333-3333-3333-3333-333333333333';

-- 4. claim_next_publishing_item() claims exactly one of the two queued rows
-- and flips it to 'processing', leaving the other untouched.
select claim_next_publishing_item();
select 'post-claim status counts' as label, status, count(*)
from public.publishing_queue
where id in ('aa111111-1111-1111-1111-111111111111', 'aa222222-2222-2222-2222-222222222222')
group by status;
