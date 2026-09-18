-- Publishing queue support: atomic claiming for the backend's publishing
-- worker, and the trigger that flips content_requests into 'scheduled' the
-- moment a creator queues the first channel. Buffer itself is what actually
-- posts at the scheduled time -- this app never polls Buffer back for a
-- final 'published' confirmation, so 'scheduled' is the practical terminal
-- status here (the check constraint keeps 'published'/'failed' for a future
-- Buffer-status-sync job, but nothing sets them yet).

alter table public.publishing_queue drop constraint publishing_queue_status_check;
alter table public.publishing_queue add constraint publishing_queue_status_check
  check (status in ('queued', 'processing', 'scheduled', 'published', 'failed'));

-- Same FOR UPDATE SKIP LOCKED pattern as claim_next_pipeline_job, so the
-- publishing worker's poll loop never double-claims a row.
create or replace function public.claim_next_publishing_item()
returns setof public.publishing_queue
language plpgsql
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.publishing_queue
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  update public.publishing_queue set status = 'processing' where id = claimed_id;

  return query select * from public.publishing_queue where id = claimed_id;
end;
$$;

revoke all on function public.claim_next_publishing_item() from public;
grant execute on function public.claim_next_publishing_item() to service_role;

-- The creator's client only ever inserts into publishing_queue (see the
-- widened RLS policy below); this trigger is what actually moves
-- content_requests to 'scheduled', following the same trusted-internal-write
-- pattern as apply_approval_decision. Only fires while still 'approved' so
-- it's a no-op on the 2nd/3rd channel queued for the same request.
create or replace function public.mark_request_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.internal_write', 'true', true);
  update public.content_requests
    set status = 'scheduled'
    where id = new.request_id and status = 'approved';
  return new;
end;
$$;

create trigger publishing_queue_mark_scheduled
  after insert on public.publishing_queue
  for each row execute procedure public.mark_request_scheduled();

-- Widen publishing_queue_insert: the original policy only allowed queueing
-- while the request was still 'approved', which meant a creator could
-- schedule exactly one channel before the trigger above moved the request to
-- 'scheduled' and locked out every other channel. Scheduling LinkedIn today
-- and X next week for the same approved request is a normal flow, so also
-- allow inserts once the request is already 'scheduled'.
drop policy publishing_queue_insert on public.publishing_queue;
create policy publishing_queue_insert on public.publishing_queue
  for insert
  with check (exists (
    select 1 from public.content_requests cr
    where cr.id = publishing_queue.request_id
      and cr.created_by = auth.uid()
      and app_role() = 'creator'
      and is_active()
      and cr.status in ('approved', 'scheduled')
  ));
