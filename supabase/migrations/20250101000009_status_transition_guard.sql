-- The RLS policy on content_requests (see 20250101000004) lets a creator
-- update any column on their own row, status included -- which as written
-- would let a creator set status = 'approved' directly and skip the
-- approver entirely. RLS's WITH CHECK only sees the NEW row, not OLD vs
-- NEW, so this transition rule needs a BEFORE trigger instead.
--
-- Bypassed for: the backend (connects as service_role), any internal
-- trigger that explicitly marks itself trusted via the app.internal_write
-- GUC (see apply_approval_decision below), and superuser/admin sessions
-- (dashboard/manual fixes) -- everyone else may only move status to
-- 'intake' (resubmitting after fixing something flagged at intake).
create or replace function public.enforce_content_request_status_transitions()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role'
     or coalesce(current_setting('app.internal_write', true), '') = 'true'
     or (select coalesce(rolsuper, false) from pg_roles where rolname = current_user)
  then
    return new;
  end if;

  if new.status is distinct from old.status and new.status <> 'intake' then
    raise exception 'Only the backend may change content_requests.status to %', new.status;
  end if;

  return new;
end;
$$;

create trigger content_requests_enforce_status_transitions
  before update on public.content_requests
  for each row execute procedure public.enforce_content_request_status_transitions();

-- Approver's client only ever inserts into approvals (see RLS policy
-- approvals_insert); this trigger is what actually propagates that
-- decision onto content_requests.status, marked as a trusted internal
-- write so the guard trigger above lets it through.
create or replace function public.apply_approval_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.internal_write', 'true', true);
  update public.content_requests
    set status = case when new.decision = 'approved' then 'approved' else 'changes_requested' end
    where id = new.request_id;
  return new;
end;
$$;

create trigger approvals_apply_decision
  after insert on public.approvals
  for each row execute procedure public.apply_approval_decision();
