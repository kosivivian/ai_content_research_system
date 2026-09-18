-- Minimal stand-in for Supabase's auth schema, for local verification only.
-- Not part of the real migration set.
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Roles Supabase normally provides.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
