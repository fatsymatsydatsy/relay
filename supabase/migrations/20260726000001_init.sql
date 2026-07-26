-- MedFind schema v1 — Postgres is the single source of truth.
-- Constraint philosophy: forbidden states are rejected by the database itself,
-- not by application discipline (see build-steps.md "Designed-out bugs").
-- Hardened per codex phase-0 review: explicit grants, verdict-leak bypasses closed,
-- dial_log lifecycle, append-only raw data, E.164 checks.

create extension if not exists pgcrypto;

-- ── enums ────────────────────────────────────────────────────────────────────
create type call_status as enum (
  'queued', 'dialing', 'transcript_ready', 'verdict',
  'unreached', 'wrong_location', 'extraction_failed', 'skipped', 'expired'
);

create type search_status as enum ('active', 'complete');

create type dial_outcome as enum ('reserved', 'connected', 'freed');

-- ── reference data ───────────────────────────────────────────────────────────
create table medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  strength text not null,
  form text not null,
  display text not null unique,          -- "Creon 25,000 gastro-resistant capsules"
  created_at timestamptz not null default now()
);

create table pharmacies (
  ods_code text primary key,             -- NHS national identifier; idempotent upserts
  name text not null,
  address text not null,
  postcode text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),  -- E.164, one representation
  lat double precision not null,
  lng double precision not null,
  hours jsonb not null,                  -- per-day sessions, Europe/London wall clock
  ownership_group text not null default 'independent',
  is_supermarket boolean not null default false,
  verified boolean not null default false,
  number_type text not null default 'geographic',  -- geographic | national
  source text not null default 'manual',           -- manual | nhs_api | dev_test
  created_at timestamptz not null default now()
);

-- ── searches ─────────────────────────────────────────────────────────────────
create table searches (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null,                   -- auth.uid() of the anonymous session
  medication_id uuid not null references medications(id),
  quantity_needed int not null default 1 check (quantity_needed between 1 and 20),
  postcode text not null,                -- postcode only; never more (PRD privacy rule)
  radius_km numeric not null check (radius_km between 0.5 and 30),
  prescription_type text,                -- collected, never sent to the agent
  status search_status not null default 'active',
  created_at timestamptz not null default now(),
  deadline_at timestamptz not null,      -- created_at + 20 min, enforced by settle
  settled_at timestamptz
);

-- ── calls: one row = one attempt to reach one pharmacy for one search ────────
create table calls (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references searches(id),
  pharmacy_ods text not null references pharmacies(ods_code),
  status call_status not null default 'queued',
  rank_score numeric,                    -- portfolio score at selection time
  is_bench boolean not null default false,
  -- dial snapshot (review finding: snapshot mode + numbers at claim time)
  dial_mode text check (dial_mode in ('DEV_TEST', 'REAL')),
  intended_number text check (intended_number is null or intended_number ~ '^\+[1-9][0-9]{6,14}$'),
  resolved_number text check (resolved_number is null or resolved_number ~ '^\+[1-9][0-9]{6,14}$'),
  claimed_at timestamptz,
  -- provider correlation (we correlate by OUR id passed as call_ref)
  conversation_id text unique,
  call_sid text,
  -- raw is truth (append-only via trigger), verdict is derived
  transcript jsonb,
  verdict jsonb,
  rank_bucket int check (rank_bucket between 1 and 4),
  location_confirmed text check (location_confirmed in ('yes', 'no', 'unclear')),
  copied_from_call_id uuid references calls(id),
  extraction_attempts int not null default 0 check (extraction_attempts between 0 and 3),
  ended_at timestamptz,
  verdict_at timestamptz,
  created_at timestamptz not null default now(),

  -- one attempt per pharmacy per search, ever (bench promotes OTHER pharmacies)
  unique (search_id, pharmacy_ods),

  -- Buckets 1-3 only on a completed, branch-confirmed call with a verdict.
  constraint stock_verdict_integrity check (
    rank_bucket is null
    or rank_bucket = 4
    or (status = 'verdict' and location_confirmed = 'yes' and verdict is not null)
  ),

  -- A verdict payload may only exist on a completed extraction with a known branch check.
  constraint verdict_requires_completion check (
    verdict is null
    or (status = 'verdict' and location_confirmed is not null)
  ),

  -- A STOCK claim (in/out) additionally requires a confirmed branch and buckets 1-3.
  -- Closes the codex-found bypass: bucket-4/null rows carrying in-stock payloads.
  constraint stock_claims_require_confirmation check (
    verdict is null
    or (verdict->>'stock_status') is null
    or (verdict->>'stock_status') not in ('in_stock', 'out_of_stock')
    or (location_confirmed = 'yes' and rank_bucket between 1 and 3)
  ),

  -- terminal failure states may never carry verdict payloads
  constraint failures_carry_no_stock check (
    status not in ('unreached', 'wrong_location', 'skipped', 'expired')
    or verdict is null
  )
);

create index calls_search_idx on calls (search_id, status);
create index calls_status_idx on calls (status) where status in ('queued', 'dialing', 'transcript_ready');

-- transcripts are write-once: NULL → value only, never replaced (raw is evidence)
create or replace function protect_transcript() returns trigger
language plpgsql as $$
begin
  if old.transcript is not null and new.transcript is distinct from old.transcript then
    raise exception 'transcript is append-only evidence and cannot be modified';
  end if;
  return new;
end $$;

create trigger calls_transcript_immutable
  before update on calls
  for each row execute function protect_transcript();

-- ── append-only raw webhook log ──────────────────────────────────────────────
create table call_events (
  id bigint generated always as identity primary key,
  call_id uuid references calls(id),
  event_type text not null,
  conversation_id text,
  dedupe_key text not null unique,       -- (type, conversation_id, payload hash)
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger call_events_append_only
  before update or delete on call_events
  for each row execute function reject_mutation();

-- ── dial log: the 1-hour politeness rule + verdict cache, WITH lifecycle ─────
-- reserved  → row inserted in the claim transaction, blocks the number
-- connected → provider accepted the call, keeps blocking
-- freed     → definite provider rejection; stops blocking but keeps audit history
create table dial_log (
  id bigint generated always as identity primary key,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  medication_id uuid references medications(id),
  call_id uuid references calls(id),
  outcome dial_outcome not null default 'reserved',
  dialed_at timestamptz not null default now()
);

-- the politeness lookup only scans rows that still block
create index dial_log_blocking_idx on dial_log (phone, dialed_at desc)
  where outcome in ('reserved', 'connected');

-- only the outcome may ever change; everything else is history
create or replace function dial_log_outcome_only() returns trigger
language plpgsql as $$
begin
  if new.phone is distinct from old.phone
     or new.medication_id is distinct from old.medication_id
     or new.call_id is distinct from old.call_id
     or new.dialed_at is distinct from old.dialed_at then
    raise exception 'dial_log rows are history — only outcome may change';
  end if;
  return new;
end $$;

create trigger dial_log_history
  before update on dial_log
  for each row execute function dial_log_outcome_only();

create trigger dial_log_no_delete
  before delete on dial_log
  for each row execute function reject_mutation();

-- ── watchdog anomaly log (it acting = something to look at) ──────────────────
create table anomalies (
  id bigint generated always as identity primary key,
  kind text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

-- ── privileges: explicit and least-privilege (never rely on defaults) ────────
-- service role (commands) gets full access + sequences
grant usage on schema public to service_role, anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- clients: read-only, and only what the UI needs
grant select on pharmacies, medications, searches to anon, authenticated;
grant select (id, search_id, pharmacy_ods, status, rank_bucket, verdict,
              location_confirmed, is_bench, verdict_at, ended_at, created_at)
  on calls to anon, authenticated;
-- call_events, dial_log, anomalies: no client grants at all (raw transcripts live here)

-- ── row-level security: deny by default, owner-scoped reads (step 4.3 wires auth) ──
alter table searches enable row level security;
alter table calls enable row level security;
alter table call_events enable row level security;
alter table dial_log enable row level security;
alter table anomalies enable row level security;
alter table pharmacies enable row level security;
alter table medications enable row level security;

-- public reference data: anyone may read
create policy pharmacies_public_read on pharmacies for select using (true);
create policy medications_public_read on medications for select using (true);

-- searches/calls: owner-only reads (anonymous sign-in provides auth.uid())
create policy searches_owner_read on searches for select using (owner = auth.uid());
create policy calls_owner_read on calls for select using (
  exists (select 1 from searches s where s.id = calls.search_id and s.owner = auth.uid())
);
-- no insert/update policies: only the service role (commands) writes.
