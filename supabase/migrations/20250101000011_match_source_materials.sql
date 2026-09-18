-- Vector prefilter for the rerank stage: nearest source_materials to a
-- query embedding (cosine distance), scoped to one request. supabase-js
-- has no way to express "order by embedding <=> x" directly, hence the RPC.
create or replace function public.match_source_materials(
  p_request_id uuid,
  p_query_embedding vector(1024),
  p_match_count int default 10
)
returns table (
  id uuid,
  source_url text,
  extracted_text text,
  metadata jsonb,
  distance float
)
language sql
stable
as $$
  select
    sm.id,
    sm.source_url,
    sm.extracted_text,
    sm.metadata,
    sm.embedding <=> p_query_embedding as distance
  from public.source_materials sm
  where sm.request_id = p_request_id
    and sm.access_status = 'ok'
    and sm.embedding is not null
  order by sm.embedding <=> p_query_embedding
  limit p_match_count;
$$;

revoke all on function public.match_source_materials(uuid, vector, int) from public;
grant execute on function public.match_source_materials(uuid, vector, int) to service_role;
