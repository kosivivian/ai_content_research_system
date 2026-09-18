-- Roles live in public.profiles, one row per auth.users row.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('creator', 'approver')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever a new auth user is created.
-- The approver-side "create account" flow creates the auth user via the
-- Supabase Admin API with raw_user_meta_data = { "role": "creator" | "approver" };
-- this trigger reads that back into public.profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'creator'),
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helpers used throughout RLS policies.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

-- Generic updated_at trigger, reused by tables below that track edits.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
