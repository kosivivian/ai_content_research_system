\set ON_ERROR_STOP off

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'match-test-creator@test.com')
on conflict (id) do nothing;

insert into public.content_requests (id, created_by, raw_idea) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444', 'match test request')
on conflict (id) do nothing;

-- Vector A: "first half" direction. Vector B: "second half" direction.
-- Cosine distance ignores magnitude, so these need to point in genuinely
-- different directions (not just differ in scale) to test ordering.
insert into public.source_materials (id, request_id, origin, source_url, extracted_text, access_status, embedding)
select
  '55555555-5555-5555-5555-555555555551',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'research_result',
  'https://a.example',
  'vector A',
  'ok',
  (select array_agg(case when g <= 256 then 1.0 else 0.0 end) from generate_series(1, 512) g)::vector
where not exists (select 1 from public.source_materials where id = '55555555-5555-5555-5555-555555555551');

insert into public.source_materials (id, request_id, origin, source_url, extracted_text, access_status, embedding)
select
  '55555555-5555-5555-5555-555555555552',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'research_result',
  'https://b.example',
  'vector B',
  'ok',
  (select array_agg(case when g <= 256 then 0.0 else 1.0 end) from generate_series(1, 512) g)::vector
where not exists (select 1 from public.source_materials where id = '55555555-5555-5555-5555-555555555552');

-- A source with no embedding yet -- must never be returned.
insert into public.source_materials (id, request_id, origin, source_url, extracted_text, access_status, embedding)
select
  '55555555-5555-5555-5555-555555555553',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'research_result',
  'https://c.example',
  'vector C (unembedded)',
  'ok',
  null
where not exists (select 1 from public.source_materials where id = '55555555-5555-5555-5555-555555555553');

-- Query vector closer to A's direction (mostly first-half weight).
select source_url, distance
from public.match_source_materials(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (select array_agg(case when g <= 200 then 1.0 else 0.0 end) from generate_series(1, 512) g)::vector,
  10
);
