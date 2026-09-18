-- voyage-3-lite outputs 512-dimensional embeddings by default -- the
-- original schema assumed 1024, which was simply wrong (only voyage-3/
-- voyage-3-large default to 1024). Fixing the column and the vector-search
-- RPC to match what the API actually returns, rather than switching to a
-- pricier model just to hit an arbitrary number.

alter table public.source_materials
  alter column embedding type vector(512);

drop function if exists public.match_source_materials(uuid, vector, int);

create or replace function public.match_source_materials(
  p_request_id uuid,
  p_query_embedding vector(512),
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
