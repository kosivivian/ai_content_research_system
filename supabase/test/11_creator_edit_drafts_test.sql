\set ON_ERROR_STOP off

insert into auth.users (id, email) values
  ('cc111111-1111-1111-1111-111111111111', 'edit-owner-creator@test.com'),
  ('cc222222-2222-2222-2222-222222222222', 'edit-other-creator@test.com')
on conflict (id) do nothing;

insert into public.content_requests (id, created_by, raw_idea, status) values
  ('cc333333-3333-3333-3333-333333333333', 'cc111111-1111-1111-1111-111111111111', 'edit test request', 'awaiting_creator')
on conflict (id) do nothing;

insert into public.content_plans (id, request_id, outline) values
  ('cc444444-4444-4444-4444-444444444444', 'cc333333-3333-3333-3333-333333333333', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.article_drafts (id, request_id, plan_id, option_number, body_markdown, version) values
  ('cc555555-5555-5555-5555-555555555555', 'cc333333-3333-3333-3333-333333333333', 'cc444444-4444-4444-4444-444444444444', 1, 'original body', 1)
on conflict (id) do nothing;

insert into public.channel_drafts (id, request_id, article_draft_id, channel, body, version) values
  ('cc666666-6666-6666-6666-666666666666', 'cc333333-3333-3333-3333-333333333333', 'cc555555-5555-5555-5555-555555555555', 'linkedin', 'original linkedin body', 1)
on conflict (id) do nothing;

-- 1. Owning creator can edit body_markdown while status='awaiting_creator'.
begin;
set role authenticated;
set local request.jwt.claim.sub = 'cc111111-1111-1111-1111-111111111111';
update public.article_drafts set body_markdown = 'edited body' where id = 'cc555555-5555-5555-5555-555555555555';
reset role;
commit;
select 'owner edits article body (expect edited body)' as label, body_markdown
from public.article_drafts where id = 'cc555555-5555-5555-5555-555555555555';

-- 2. Owning creator can edit channel_drafts.body too.
begin;
set role authenticated;
set local request.jwt.claim.sub = 'cc111111-1111-1111-1111-111111111111';
update public.channel_drafts set body = 'edited linkedin body' where id = 'cc666666-6666-6666-6666-666666666666';
reset role;
commit;
select 'owner edits channel body (expect edited linkedin body)' as label, body
from public.channel_drafts where id = 'cc666666-6666-6666-6666-666666666666';

-- 3. A different creator's edit silently affects 0 rows (RLS USING clause
-- doesn't match -- normal UPDATE behavior, not an exception).
begin;
set role authenticated;
set local request.jwt.claim.sub = 'cc222222-2222-2222-2222-222222222222';
update public.article_drafts set body_markdown = 'hijacked' where id = 'cc555555-5555-5555-5555-555555555555';
reset role;
commit;
select 'non-owner edit has no effect (expect edited body, unchanged)' as label, body_markdown
from public.article_drafts where id = 'cc555555-5555-5555-5555-555555555555';

-- 4. Owner cannot edit a different column (version) -- should FAIL outright,
-- a column-level grant violation, not just RLS.
begin;
set role authenticated;
set local request.jwt.claim.sub = 'cc111111-1111-1111-1111-111111111111';
savepoint sp1;
update public.article_drafts set version = 99 where id = 'cc555555-5555-5555-5555-555555555555';
rollback to savepoint sp1;
reset role;
commit;
select 'version column still protected (expect 1)' as label, version
from public.article_drafts where id = 'cc555555-5555-5555-5555-555555555555';

-- 5. Once approved, the creator can no longer edit the draft.
update public.content_requests set status = 'approved' where id = 'cc333333-3333-3333-3333-333333333333';

begin;
set role authenticated;
set local request.jwt.claim.sub = 'cc111111-1111-1111-1111-111111111111';
update public.article_drafts set body_markdown = 'too late' where id = 'cc555555-5555-5555-5555-555555555555';
reset role;
commit;
select 'edit blocked once approved (expect edited body, unchanged)' as label, body_markdown
from public.article_drafts where id = 'cc555555-5555-5555-5555-555555555555';
