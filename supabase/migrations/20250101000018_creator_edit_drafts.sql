-- Lets the owning creator hand-edit the article/channel draft content
-- directly, instead of only being able to resubmit the original idea from
-- intake (which re-runs the whole pipeline). Previously article_drafts and
-- channel_drafts had no write policy for `authenticated` at all -- the
-- backend's service role was the only writer -- so after an approver
-- rejected a request, the creator genuinely had no way to change anything
-- before resending it.
--
-- Scoped narrowly: only the request's own creator, only while the request
-- is in the review-and-decide phase ('awaiting_creator' or
-- 'changes_requested'), and only the content column itself -- not version,
-- citations, or any other field -- via column-level grants.

grant update (body_markdown) on public.article_drafts to authenticated;
grant update (body) on public.channel_drafts to authenticated;

create policy article_drafts_update_own on public.article_drafts
  for update
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = article_drafts.request_id
      and cr.created_by = auth.uid()
      and app_role() = 'creator'
      and is_active()
      and cr.status in ('awaiting_creator', 'changes_requested')
  ))
  with check (exists (
    select 1 from public.content_requests cr
    where cr.id = article_drafts.request_id
      and cr.created_by = auth.uid()
  ));

create policy channel_drafts_update_own on public.channel_drafts
  for update
  using (exists (
    select 1 from public.content_requests cr
    where cr.id = channel_drafts.request_id
      and cr.created_by = auth.uid()
      and app_role() = 'creator'
      and is_active()
      and cr.status in ('awaiting_creator', 'changes_requested')
  ))
  with check (exists (
    select 1 from public.content_requests cr
    where cr.id = channel_drafts.request_id
      and cr.created_by = auth.uid()
  ));
