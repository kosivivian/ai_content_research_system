begin;
select id as claimed_job_id from public.claim_next_pipeline_job() \gset
select pg_sleep(3);
commit;
select :'claimed_job_id' as claimed_by_this_session;
