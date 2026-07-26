-- 1.2 Relay fold-in — schema pieces the vendored UI needs.
--
-- 1) waitlist_signups: the landing page's email capture (from the relay repo's
--    supabase/schema.sql, restated in this repo's explicit-grants convention).
-- 2) realtime publication: the /search board (1.5) subscribes to its own
--    searches + calls rows; RLS (owner-scoped, defined in init) filters what
--    each anonymous session can see — the publication only makes changes flow.

-- ── waitlist ─────────────────────────────────────────────────────────────────
create table waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (email ~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,255}$'),
  created_at timestamptz not null default now()
);

alter table waitlist_signups enable row level security;

-- anon may add a signup but NEVER read the list back (no select grant/policy)
create policy waitlist_insert_only on waitlist_signups
  for insert to anon, authenticated with check (true);

-- convention (0.5): explicit grants for every new table, never defaults
grant insert on waitlist_signups to anon, authenticated;
grant all on waitlist_signups to service_role;

-- the public sees only an aggregate count (security definer bypasses RLS to
-- count without exposing rows); empty search_path + qualified name per
-- SECURITY DEFINER hygiene, and default PUBLIC execute is revoked so only the
-- granted roles may call it (explicit-grants convention)
create or replace function waitlist_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::int from public.waitlist_signups;
$$;

revoke execute on function waitlist_count() from public;
grant execute on function waitlist_count() to anon, authenticated, service_role;

-- ── realtime publication for the live board ──────────────────────────────────
-- Supabase provisions the supabase_realtime publication outside migrations;
-- guard so this also applies on a bare shadow database.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table searches, calls;
