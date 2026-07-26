-- MedFind schema v1 — Postgres is the single source of truth.
-- Constraint philosophy: forbidden states are rejected by the database itself,
-- not by application discipline (see build-steps.md "Designed-out bugs").

create extension if not exists pgcrypto;

-- ── enums ────────────────────────────────────────────────────────────────────
create type call_status as enum (
  'queued', 'dialing', 'transcript_ready', 'verdict',
  'unreached', 'wrong_location', 'extraction_failed', 'skipped', 'expired'
);

create type search_status as enum ('active', 'complete');

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
  phone text not null,                   -- E.164
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
  intended_number text,
  resolved_number text,
  claimed_at timestamptz,
  -- provider correlation (we correlate by OUR id passed as call_ref)
  conversation_id text unique,
  call_sid text,
  -- raw is truth, verdict is derived
  transcript jsonb,
  verdict jsonb,
  rank_bucket int check (rank_bucket between 1 and 4),
  location_confirmed text check (location_confirmed in ('yes', 'no', 'unclear')),
  copied_from_call_id uuid references calls(id),
  extraction_attempts int not null default 0 check (extraction_attempts <= 3),
  ended_at timestamptz,
  verdict_at timestamptz,
  created_at timestamptz not null default now(),

  -- one attempt per pharmacy per search, ever (bench promotes OTHER pharmacies)
  unique (search_id, pharmacy_ods),

  -- THE honesty constraint: a stock verdict (buckets 1-3) can only exist on a
  -- completed call whose branch identity a human confirmed.
  constraint stock_verdict_integrity check (
    rank_bucket is null
    or rank_bucket = 4
    or (status = 'verdict' and location_confirmed = 'yes' and verdict is not null)
  ),

  -- terminal failure states may never carry stock payloads
  constraint failures_carry_no_stock check (
    status not in ('unreached', 'wrong_location', 'skipped', 'expired')
    or verdict is null
  )
);

create index calls_search_idx on calls (search_id, status);
create index calls_status_idx on calls (status) where status in ('queued', 'dialing', 'transcript_ready');

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

-- ── dial log: feeds the 1-hour politeness rule + the verdict cache ───────────
create table dial_log (
  id bigint generated always as identity primary key,
  phone text not null,
  medication_id uuid references medications(id),
  call_id uuid references calls(id),
  dialed_at timestamptz not null default now()
);

create index dial_log_phone_idx on dial_log (phone, dialed_at desc);

-- ── watchdog anomaly log (it acting = something to look at) ──────────────────
create table anomalies (
  id bigint generated always as identity primary key,
  kind text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

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
-- call_events / dial_log / anomalies: no policies at all — service-role only.

-- the browser must never receive raw transcripts (review finding #9):
revoke select on calls from anon, authenticated;
grant select (id, search_id, pharmacy_ods, status, rank_bucket, verdict,
              location_confirmed, is_bench, verdict_at, ended_at, created_at)
  on calls to anon, authenticated;
