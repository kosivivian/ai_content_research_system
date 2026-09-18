-- Bucket for creator-uploaded supporting material (images/PDFs read via
-- Claude's multimodal input during intake). Not covered by the local
-- Docker test harness -- the stub Postgres image has no `storage` schema,
-- only a real Supabase project does. Verify manually there.
--
-- Path convention: "<creator_uuid>/<filename>", enforced below so a
-- creator can only read/write their own folder.
insert into storage.buckets (id, name, public)
values ('supporting-materials', 'supporting-materials', false)
on conflict (id) do nothing;

create policy supporting_materials_owner_rw
  on storage.objects for all
  using (bucket_id = 'supporting-materials' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'supporting-materials' and (storage.foldername(name))[1] = auth.uid()::text);
