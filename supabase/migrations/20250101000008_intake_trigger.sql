-- The frontend inserts content_requests directly (RLS-permitted for the
-- owning creator) rather than going through a custom HTTP endpoint. This
-- trigger is what actually gets the pipeline moving: it enqueues an
-- "intake" pipeline_jobs row on first submission, and again whenever a
-- creator fixes something and resets status back to 'intake' to resubmit.
create or replace function public.enqueue_intake_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pipeline_jobs (request_id, stage) values (new.id, 'intake');
  return new;
end;
$$;

create trigger content_requests_enqueue_intake_on_insert
  after insert on public.content_requests
  for each row execute procedure public.enqueue_intake_job();

create trigger content_requests_enqueue_intake_on_resubmit
  after update on public.content_requests
  for each row
  when (new.status = 'intake' and old.status is distinct from 'intake')
  execute procedure public.enqueue_intake_job();
