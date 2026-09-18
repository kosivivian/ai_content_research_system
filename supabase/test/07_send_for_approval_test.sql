\set ON_ERROR_STOP off

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'send-for-approval-creator@test.com')
on conflict (id) do nothing;

insert into public.content_requests (id, created_by, raw_idea, status) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-6666-6666-6666-666666666666', 'req awaiting_creator', 'awaiting_creator'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '66666666-6666-6666-6666-666666666666', 'req changes_requested', 'changes_requested'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '66666666-6666-6666-6666-666666666666', 'req intake', 'intake')
on conflict (id) do nothing;

-- 1. awaiting_creator -> awaiting_approval: should SUCCEED.
begin;
set role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
update public.content_requests set status = 'awaiting_approval' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
reset role;
commit;
select 'awaiting_creator -> awaiting_approval (expect awaiting_approval)' as label, status
from public.content_requests where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- 2. changes_requested -> awaiting_approval: should SUCCEED.
begin;
set role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
update public.content_requests set status = 'awaiting_approval' where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
reset role;
commit;
select 'changes_requested -> awaiting_approval (expect awaiting_approval)' as label, status
from public.content_requests where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

-- 3. intake -> awaiting_approval: should FAIL (not one of the allowed source statuses).
begin;
set role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
savepoint sp1;
update public.content_requests set status = 'awaiting_approval' where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
rollback to savepoint sp1;
reset role;
commit;
select 'intake -> awaiting_approval blocked (expect intake)' as label, status
from public.content_requests where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- 4. Still cannot self-approve directly: awaiting_creator -> approved should FAIL.
insert into public.content_requests (id, created_by, raw_idea, status) values
  ('11223344-1122-1122-1122-112233445566', '66666666-6666-6666-6666-666666666666', 'req self-approve attempt', 'awaiting_creator')
on conflict (id) do nothing;

begin;
set role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
savepoint sp2;
update public.content_requests set status = 'approved' where id = '11223344-1122-1122-1122-112233445566';
rollback to savepoint sp2;
reset role;
commit;
select 'self-approve still blocked (expect awaiting_creator)' as label, status
from public.content_requests where id = '11223344-1122-1122-1122-112233445566';
