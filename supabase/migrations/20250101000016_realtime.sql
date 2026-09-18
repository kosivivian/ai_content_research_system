-- Lets the frontend subscribe to live Postgres changes (Supabase Realtime)
-- instead of only re-fetching after a button the viewer themselves clicked.
-- The request detail page listens for content_requests updates and new
-- activity_log/error_logs rows for the open request, so it reflects the
-- backend worker's progress live instead of needing a manual refresh.
--
-- Supabase Cloud creates the `supabase_realtime` publication automatically;
-- the plain Docker pgvector test stub doesn't have it (same category of gap
-- as the storage bucket in 20250101000010 -- verify Realtime manually
-- against a real project), so this no-ops there instead of failing the
-- migration run.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.content_requests';
    execute 'alter publication supabase_realtime add table public.activity_log';
    execute 'alter publication supabase_realtime add table public.error_logs';
  end if;
end
$$;
