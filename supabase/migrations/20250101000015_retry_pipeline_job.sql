-- Lets the owning creator or any approver retry a permanently-failed
-- pipeline_jobs row from where it stopped, instead of resubmitting the
-- whole request from intake. authenticated only has SELECT on
-- pipeline_jobs (see 20250101000005_grants.sql) -- this function does the
-- actual update as security definer, but enforces its own authorization
-- check first rather than relying on a table grant, since "owning creator
-- OR any approver" isn't expressible as a simple RLS policy without also
-- letting either role write pipeline_jobs directly for anything else.
create or replace function public.retry_pipeline_job(p_job_id uuid)
returns setof public.pipeline_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_owner_id uuid;
begin
  select pj.request_id, cr.created_by
    into v_request_id, v_owner_id
  from public.pipeline_jobs pj
  join public.content_requests cr on cr.id = pj.request_id
  where pj.id = p_job_id
    and pj.status = 'failed';

  if v_request_id is null then
    raise exception 'No failed pipeline_jobs row % found', p_job_id;
  end if;

  if not (
    is_active()
    and ((v_owner_id = auth.uid() and app_role() = 'creator') or app_role() = 'approver')
  ) then
    raise exception 'Not authorized to retry this job';
  end if;

  -- Fresh retry budget: attempt_count resets so this doesn't immediately
  -- re-fail on its first requeued attempt if it was already at the cap.
  update public.pipeline_jobs
    set status = 'queued', attempt_count = 0
    where id = p_job_id;

  return query select * from public.pipeline_jobs where id = p_job_id;
end;
$$;

revoke all on function public.retry_pipeline_job(uuid) from public;
grant execute on function public.retry_pipeline_job(uuid) to authenticated;
