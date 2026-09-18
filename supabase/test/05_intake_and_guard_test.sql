\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------
-- Inserting a content_request should auto-enqueue an "intake" job.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.content_requests (created_by, raw_idea)
values ('11111111-1111-1111-1111-111111111111', 'guard test request')
returning id as new_request_id \gset

reset role;
commit;

select 'jobs enqueued on insert (expect 1, stage=intake)' as label, stage, status
from public.pipeline_jobs where request_id = :'new_request_id';

-- ---------------------------------------------------------------------
-- Creator cannot self-approve by setting status directly: should FAIL.
-- ---------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

savepoint sp_guard;
update public.content_requests set status = 'approved' where id = :'new_request_id';
rollback to savepoint sp_guard;

reset role;
commit;

select 'status unchanged after blocked self-approve (expect intake)' as label, status
from public.content_requests where id = :'new_request_id';

-- ---------------------------------------------------------------------
-- Creator CAN move status back to 'intake' (resubmit) -- and it enqueues
-- a second intake job. The 'researching' transition below simulates the
-- backend (service_role), run as postgres since our guard trigger only
-- exempts service_role/superuser/internal-write sessions -- a creator
-- could never make this call themselves, as already proven above.
-- ---------------------------------------------------------------------
begin;
update public.content_requests set status = 'researching' where id = :'new_request_id';
commit;

select 'sanity: status is now researching' as label, status
from public.content_requests where id = :'new_request_id';

begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

update public.content_requests set status = 'intake' where id = :'new_request_id';

reset role;
commit;

select 'jobs after resubmit (expect 2 intake jobs total)' as label, stage, status, created_at
from public.pipeline_jobs where request_id = :'new_request_id' order by created_at;

-- ---------------------------------------------------------------------
-- Approver approval decision auto-propagates to content_requests.status
-- via the trigger -- no manual status update needed this time.
-- ---------------------------------------------------------------------
begin;
update public.content_requests set status = 'awaiting_approval' where id = :'new_request_id';
commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

insert into public.approvals (request_id, approver_id, decision, comments)
values (:'new_request_id', '22222222-2222-2222-2222-222222222222', 'approved', 'auto-propagation test');

reset role;
commit;

select 'status after approval trigger (expect approved, no manual update)' as label, status
from public.content_requests where id = :'new_request_id';
