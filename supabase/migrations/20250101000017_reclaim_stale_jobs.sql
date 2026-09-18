-- Nothing previously reclaimed a job whose worker died mid-flight (crash,
-- a `tsx watch` restart, a hung network call the client-side timeout hadn't
-- caught) -- it stayed 'running' forever, since only the worker process
-- that originally claimed it was ever going to mark it done/failed. Caught
-- live: an evaluate_article job got claimed, its worker process restarted
-- moments later from an unrelated code change, and the job was orphaned in
-- 'running' with nothing able to pick it back up short of a manual fix.
--
-- Fix: claim_next_pipeline_job() now also reclaims a 'running' job whose
-- updated_at is more than 5 minutes old (comfortably above the Anthropic
-- client's own 120s request timeout, so this only ever fires for a job
-- that's actually orphaned, not one still legitimately in flight).
-- attempt_count still increments on a reclaim, so a job that keeps getting
-- orphaned for some other reason still eventually hits WORKER_MAX_ATTEMPTS
-- and surfaces as 'errored' rather than reclaim-looping forever.
create or replace function public.claim_next_pipeline_job()
returns setof public.pipeline_jobs
language plpgsql
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.pipeline_jobs
  where status = 'queued'
     or (status = 'running' and updated_at < now() - interval '5 minutes')
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  update public.pipeline_jobs
    set status = 'running', attempt_count = attempt_count + 1
    where id = claimed_id;

  return query select * from public.pipeline_jobs where id = claimed_id;
end;
$$;
