-- RLS smoke test: run as postgres (superuser can SET ROLE to any role;
-- once we SET ROLE authenticated, RLS applies to that session normally).
\set ON_ERROR_STOP off

begin;

-- Seed two creators and one approver via auth.users so the profile trigger fires.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'creator1@test.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'creator2@test.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'approver1@test.com', '{"role":"approver"}');

select id, email, role, active from public.profiles order by email;

commit;

-- ---------------------------------------------------------------------
-- Creator1 inserts their own request: should succeed.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.content_requests (created_by, raw_idea, target_audience, tone)
values ('11111111-1111-1111-1111-111111111111', 'creator1 own request', 'devs', 'casual')
returning id, created_by, status;

reset role;
commit;

-- ---------------------------------------------------------------------
-- Creator1 tries to insert a request on behalf of creator2: should FAIL.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

savepoint sp1;
insert into public.content_requests (created_by, raw_idea)
values ('33333333-3333-3333-3333-333333333333', 'spoofed request');
rollback to savepoint sp1;

reset role;
commit;

-- ---------------------------------------------------------------------
-- Creator2 should not see creator1's request; approver should see both.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select 'creator2 sees (expect 0 rows)' as label, count(*) from public.content_requests;
reset role;
commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'approver sees (expect 1 row)' as label, count(*) from public.content_requests;

-- Approver tries to insert a content_request directly: should FAIL.
savepoint sp2;
insert into public.content_requests (created_by, raw_idea)
values ('22222222-2222-2222-2222-222222222222', 'approver trying to author content');
rollback to savepoint sp2;

reset role;
commit;

-- ---------------------------------------------------------------------
-- Approver tries to approve a request that is NOT awaiting_approval: FAIL.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

savepoint sp3;
insert into public.approvals (request_id, approver_id, decision)
select id, '22222222-2222-2222-2222-222222222222', 'approved'
from public.content_requests where raw_idea = 'creator1 own request';
rollback to savepoint sp3;

reset role;
commit;

-- Move the request to awaiting_approval (simulating the backend/service role).
begin;
update public.content_requests set status = 'awaiting_approval'
where raw_idea = 'creator1 own request';
commit;

-- Now the same approval should SUCCEED.
begin;
set role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

insert into public.approvals (request_id, approver_id, decision, comments)
select id, '22222222-2222-2222-2222-222222222222', 'approved', 'looks good'
from public.content_requests where raw_idea = 'creator1 own request'
returning id, decision;

reset role;
commit;

-- ---------------------------------------------------------------------
-- publishing_queue: creator1 cannot queue while status != 'approved'.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

savepoint sp4;
insert into public.publishing_queue (request_id, channel)
select id, 'linkedin' from public.content_requests where raw_idea = 'creator1 own request';
rollback to savepoint sp4;

reset role;
commit;

-- Move status to approved (simulating backend after approvals insert).
begin;
update public.content_requests set status = 'approved'
where raw_idea = 'creator1 own request';
commit;

-- Now creator1's publishing_queue insert should SUCCEED.
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.publishing_queue (request_id, channel)
select id, 'linkedin' from public.content_requests where raw_idea = 'creator1 own request'
returning id, channel, status;

reset role;
commit;

select 'FINAL content_requests' as label, raw_idea, status from public.content_requests order by created_at;
select 'FINAL approvals' as label, decision, comments from public.approvals;
select 'FINAL publishing_queue' as label, channel, status from public.publishing_queue;
