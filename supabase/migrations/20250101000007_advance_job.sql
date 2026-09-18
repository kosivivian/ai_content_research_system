-- Marks a job done and enqueues the next stage's job atomically, so a
-- crash between the two writes can never leave a request stuck (done with
-- no successor) or duplicated (successor inserted twice).
create or replace function public.advance_pipeline_job(p_job_id uuid, p_next_stage text)
returns setof public.pipeline_jobs
language plpgsql
as $$
declare
  v_request_id uuid;
begin
  select request_id into v_request_id
  from public.pipeline_jobs
  where id = p_job_id;

  if v_request_id is null then
    raise exception 'pipeline_jobs row % not found', p_job_id;
  end if;

  update public.pipeline_jobs set status = 'done' where id = p_job_id;

  return query
    insert into public.pipeline_jobs (request_id, stage)
    values (v_request_id, p_next_stage)
    returning *;
end;
$$;

revoke all on function public.advance_pipeline_job(uuid, text) from public;
grant execute on function public.advance_pipeline_job(uuid, text) to service_role;
