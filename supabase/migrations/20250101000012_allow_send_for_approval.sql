-- The status-transition guard (20250101000009) only ever let a creator's
-- direct update move status to 'intake' (resubmit after an intake block).
-- That missed the one other client-driven transition a creator actually
-- needs: sending a reviewed package to the approver. Redefining the same
-- function (CREATE OR REPLACE) rather than a new one, since this is a
-- refinement of that same rule, not a separate concern.
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

  if new.status is distinct from old.status then
    if new.status = 'intake' then
      return new; -- resubmitting after an intake block
    end if;

    if new.status = 'awaiting_approval' and old.status in ('awaiting_creator', 'changes_requested') then
      return new; -- creator sending the reviewed package to the approver
    end if;

    raise exception 'Only the backend may change content_requests.status from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;
