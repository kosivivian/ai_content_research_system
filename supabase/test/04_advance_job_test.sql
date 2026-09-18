select id as job_id from public.pipeline_jobs where stage = 'intake' order by created_at limit 1 \gset

select * from public.advance_pipeline_job(:'job_id', 'research');

select id, stage, status from public.pipeline_jobs order by created_at;
