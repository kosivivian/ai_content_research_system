-- Atomic job claiming for the backend worker loop. Using FOR UPDATE SKIP
-- LOCKED means multiple worker instances (or overlapping poll ticks) can
-- never claim the same row, which matters once we're running up to 5
-- requests concurrently.
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

-- Backend-only: the worker calls this via the service role key.
revoke all on function public.claim_next_pipeline_job() from public;
grant execute on function public.claim_next_pipeline_job() to service_role;
