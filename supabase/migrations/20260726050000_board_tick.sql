-- 1.5 board tick — how the live board hears about calls changes.
--
-- Finding (probe-verified, local + cloud): Supabase Realtime only delivers
-- postgres_changes to roles holding TABLE-level SELECT on the table; column
-- grants don't satisfy its check. `calls` deliberately has only column grants
-- (transcript / dial numbers must never reach clients), so clients cannot
-- subscribe to `calls` at all — and granting the table would leak the private
-- columns through PostgREST.
--
-- Fix: any calls change bumps its parent searches row (trigger below); the
-- client subscribes to its OWN searches row (full-row grant + owner RLS —
-- delivery proven) and refetches the column-granted calls on each tick.
-- The publication column list from the previous migration stays as
-- defense-in-depth. Structural split of private columns into a service-only
-- table is the post-hackathon refactor.

alter table searches add column updated_at timestamptz not null default now();

create or replace function bump_search_updated_at() returns trigger
language plpgsql as $$
begin
  update searches set updated_at = now() where id = new.search_id;
  return new;
end $$;

create trigger calls_bump_search
  after insert or update on calls
  for each row execute function bump_search_updated_at();
