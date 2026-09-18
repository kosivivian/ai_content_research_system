-- Foreign-key lookups the app does constantly (per-request child rows).
create index content_requests_created_by_idx on public.content_requests (created_by);
create index source_materials_request_id_idx on public.source_materials (request_id);
create index research_queries_request_id_idx on public.research_queries (request_id);
create index reranked_sources_request_id_idx on public.reranked_sources (request_id);
create index reranked_sources_source_material_id_idx on public.reranked_sources (source_material_id);
create index content_plans_request_id_idx on public.content_plans (request_id);
create index article_drafts_request_id_idx on public.article_drafts (request_id);
create index article_drafts_plan_id_idx on public.article_drafts (plan_id);
create index channel_drafts_request_id_idx on public.channel_drafts (request_id);
create index channel_drafts_article_draft_id_idx on public.channel_drafts (article_draft_id);
create index evaluations_request_id_idx on public.evaluations (request_id);
create index evaluations_target_idx on public.evaluations (target_type, target_id);
create index approvals_request_id_idx on public.approvals (request_id);
create index publishing_queue_request_id_idx on public.publishing_queue (request_id);
create index activity_log_request_id_idx on public.activity_log (request_id);
create index error_logs_request_id_idx on public.error_logs (request_id);
create index pipeline_jobs_request_id_idx on public.pipeline_jobs (request_id);
create index pipeline_jobs_status_idx on public.pipeline_jobs (status);

-- Vector similarity search for the retrieval/rerank stages.
-- lists=100 is a reasonable default at low row counts; revisit once
-- source_materials grows past a few thousand rows.
create index source_materials_embedding_idx
  on public.source_materials
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
