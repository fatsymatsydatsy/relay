-- 1.1 Fake data seed — one demo search whose 10 call rows cover EVERY UI state
-- and bucket, so the scoreboard (1.4) can be judged without a single real call.
--
-- Run by hand (never part of db reset, so constraint proofs stay on a clean DB):
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-fake-board.sql
--
-- Idempotent via UPSERTS, not delete-and-reinsert: the 0.5 delete guard
-- forbids deleting transcript-bearing calls (they're evidence), so re-runs
-- update rows in place (fixture transcripts are constant, which the
-- append-only transcript trigger accepts). Also the template the stub
-- create_search command (1.5) clones for each anonymous session.
--
-- Conventions established here (later phases must keep them):
--   hours jsonb   {"mon":[["09:00","18:00"]], ...} per-day session list,
--                 Europe/London wall clock; 24/7 = ["00:00","24:00"] every day.
--   verdict jsonb {stock_status: in_stock|orderable|out_of_stock,
--                  quantity_available int|null, quantity_unit text|null,
--                  eta text|null, notes text|null}

begin;

-- ── demo identities ──────────────────────────────────────────────────────────
-- Fixed owner uuid: RLS hides these rows from every real anonymous session;
-- they are visible in Studio and to the service role (stub command template).
\set demo_owner '''a0000000-0000-4000-8000-000000000001'''

-- ── medication ───────────────────────────────────────────────────────────────
insert into medications (id, name, strength, form, display) values
  ('b0000000-0000-4000-8000-000000000001', 'Creon', '25,000 units',
   'gastro-resistant capsules', 'Creon 25,000 gastro-resistant capsules')
on conflict (id) do update set
  name = excluded.name, strength = excluded.strength,
  form = excluded.form, display = excluded.display;

-- ── 10 fake 24/7 pharmacies (DEV_TEST politeness-by-data: always open) ──────
-- Phones use the Ofcom drama range +44 7700 900xxx — never real numbers.
-- Coords ring central Birmingham (demo area is B5 per runbook 5.1).
with h as (
  select jsonb_build_object(
    'mon', jsonb_build_array(jsonb_build_array('00:00','24:00')),
    'tue', jsonb_build_array(jsonb_build_array('00:00','24:00')),
    'wed', jsonb_build_array(jsonb_build_array('00:00','24:00')),
    'thu', jsonb_build_array(jsonb_build_array('00:00','24:00')),
    'fri', jsonb_build_array(jsonb_build_array('00:00','24:00')),
    'sat', jsonb_build_array(jsonb_build_array('00:00','24:00')),
    'sun', jsonb_build_array(jsonb_build_array('00:00','24:00'))
  ) as all_day
)
insert into pharmacies
  (ods_code, name, address, postcode, phone, lat, lng, hours,
   ownership_group, is_supermarket, verified, number_type, source)
select v.ods, v.name, v.addr, v.pc, v.phone, v.lat, v.lng, h.all_day,
       v.grp, v.market, false, 'geographic', 'dev_test'
from h, (values
  ('FAKE01', 'Wellfield Pharmacy',   '42 High Street',     'B5 4BU', '+447700900001', 52.4751, -1.8940, 'independent', false),
  ('FAKE02', 'St Martins Chemist',   '8 Station Road',     'B5 4TD', '+447700900002', 52.4772, -1.8892, 'independent', false),
  ('FAKE03', 'Rea Valley Pharmacy',  '119 London Road',    'B5 6ND', '+447700900003', 52.4700, -1.8863, 'reavalley',   false),
  ('FAKE04', 'Bullring Pharmacy',    '3 Market Square',    'B5 4QG', '+447700900004', 52.4776, -1.8936, 'reavalley',   false),
  ('FAKE05', 'Digbeth Chemist',      '27 Bridge Street',   'B5 6DY', '+447700900005', 52.4738, -1.8811, 'independent', false),
  ('FAKE06', 'Moor St Pharmacy',     '5 Moor Street',      'B5 5BD', '+447700900006', 52.4790, -1.8919, 'independent', false),
  ('FAKE07', 'Camp Hill Pharmacy',   '61 Camp Hill',       'B5 5JN', '+447700900007', 52.4696, -1.8760, 'independent', false),
  ('FAKE08', 'Asda Pharmacy',        'Barford Rd Estate',  'B5 7RJ', '+447700900008', 52.4725, -1.9020, 'asda',        true),
  ('FAKE09', 'Highgate Pharmacy',    '14 Highgate Road',   'B5 7XE', '+447700900009', 52.4660, -1.8890, 'independent', false),
  ('FAKE10', 'Smallbrook Chemist',   '90 Smallbrook Way',  'B5 4EL', '+447700900010', 52.4762, -1.8975, 'independent', false)
) as v(ods, name, addr, pc, phone, lat, lng, grp, market)
on conflict (ods_code) do update set
  name = excluded.name, address = excluded.address,
  postcode = excluded.postcode, phone = excluded.phone,
  lat = excluded.lat, lng = excluded.lng, hours = excluded.hours,
  ownership_group = excluded.ownership_group,
  is_supermarket = excluded.is_supermarket, source = excluded.source;

-- ── the demo search: needs 2 boxes, so partial stock reads "1 box — you need 2"
insert into searches
  (id, owner, medication_id, quantity_needed, postcode, radius_km,
   status, created_at, deadline_at)
values
  ('c0000000-0000-4000-8000-000000000001', :demo_owner,
   'b0000000-0000-4000-8000-000000000001', 2, 'B5 4BU', 5,
   'active', now() - interval '6 minutes', now() + interval '14 minutes')
on conflict (id) do update set
  quantity_needed = excluded.quantity_needed, postcode = excluded.postcode,
  radius_km = excluded.radius_km, status = excluded.status,
  created_at = excluded.created_at, deadline_at = excluded.deadline_at,
  settled_at = null;

-- ── 10 calls, one per UI state ──────────────────────────────────────────────
insert into calls
  (search_id, pharmacy_ods, status, rank_bucket, location_confirmed,
   dial_mode, intended_number, resolved_number, claimed_at,
   conversation_id, transcript, verdict, ended_at, verdict_at, created_at)
values
  -- 1 queued: untouched, waiting for a dial slot
  ('c0000000-0000-4000-8000-000000000001', 'FAKE09', 'queued',
   null, null, null, null, null, null, null, null, null, null, null,
   now() - interval '6 minutes'),

  -- 2 dialing: claimed, phone ringing right now
  ('c0000000-0000-4000-8000-000000000001', 'FAKE06', 'dialing',
   null, null, 'DEV_TEST', '+447700900006', '+447700900006',
   now() - interval '40 seconds', 'conv_demo_dialing',
   null, null, null, null, now() - interval '6 minutes'),

  -- 3 transcript_ready: call over, extraction still running ("checking")
  ('c0000000-0000-4000-8000-000000000001', 'FAKE07', 'transcript_ready',
   null, null, 'DEV_TEST', '+447700900007', '+447700900007',
   now() - interval '3 minutes', 'conv_demo_transcript',
   '{"turns": [{"role": "agent", "text": "Do you have Creon 25,000 in stock?"},
               {"role": "pharmacist", "text": "Let me check the shelf..."}]}',
   null, now() - interval '20 seconds', null, now() - interval '6 minutes'),

  -- 4 verdict bucket 1: in stock, full quantity
  ('c0000000-0000-4000-8000-000000000001', 'FAKE01', 'verdict',
   1, 'yes', 'DEV_TEST', '+447700900001', '+447700900001',
   now() - interval '5 minutes', 'conv_demo_instock',
   '{"turns": [{"role": "pharmacist", "text": "Yes we have two boxes of Creon 25,000."}]}',
   '{"stock_status": "in_stock", "quantity_available": 2, "quantity_unit": "boxes",
     "eta": null, "notes": null}',
   now() - interval '4 minutes', now() - interval '4 minutes',
   now() - interval '6 minutes'),

  -- 5 verdict bucket 1: PARTIAL stock (1 box, search needs 2) — still bucket 1
  ('c0000000-0000-4000-8000-000000000001', 'FAKE02', 'verdict',
   1, 'yes', 'DEV_TEST', '+447700900002', '+447700900002',
   now() - interval '5 minutes', 'conv_demo_partial',
   '{"turns": [{"role": "pharmacist", "text": "Only one box left I''m afraid."}]}',
   '{"stock_status": "in_stock", "quantity_available": 1, "quantity_unit": "boxes",
     "eta": null, "notes": "last box on the shelf"}',
   now() - interval '3 minutes', now() - interval '3 minutes',
   now() - interval '6 minutes'),

  -- 6 verdict bucket 2: none now, can order for tomorrow morning
  ('c0000000-0000-4000-8000-000000000001', 'FAKE03', 'verdict',
   2, 'yes', 'DEV_TEST', '+447700900003', '+447700900003',
   now() - interval '5 minutes', 'conv_demo_orderable',
   '{"turns": [{"role": "pharmacist", "text": "We can order it in for tomorrow morning."}]}',
   '{"stock_status": "orderable", "quantity_available": null, "quantity_unit": null,
     "eta": "tomorrow morning", "notes": "orders placed before 5pm arrive next day"}',
   now() - interval '2 minutes', now() - interval '2 minutes',
   now() - interval '6 minutes'),

  -- 7 verdict bucket 3: plain no stock (national shortage mention)
  ('c0000000-0000-4000-8000-000000000001', 'FAKE04', 'verdict',
   3, 'yes', 'DEV_TEST', '+447700900004', '+447700900004',
   now() - interval '4 minutes', 'conv_demo_nostock',
   '{"turns": [{"role": "pharmacist", "text": "None at all — it''s the national shortage."}]}',
   '{"stock_status": "out_of_stock", "quantity_available": 0, "quantity_unit": "boxes",
     "eta": null, "notes": "national shortage mentioned"}',
   now() - interval '90 seconds', now() - interval '90 seconds',
   now() - interval '6 minutes'),

  -- 8 unreached (bucket 4): rang out / voicemail — NEVER a stock verdict
  ('c0000000-0000-4000-8000-000000000001', 'FAKE05', 'unreached',
   4, null, 'DEV_TEST', '+447700900005', '+447700900005',
   now() - interval '4 minutes', 'conv_demo_unreached',
   null, null, now() - interval '2 minutes', null,
   now() - interval '6 minutes'),

  -- 9 wrong_location (bucket 4): answered, but it's another branch
  ('c0000000-0000-4000-8000-000000000001', 'FAKE08', 'wrong_location',
   4, 'no', 'DEV_TEST', '+447700900008', '+447700900008',
   now() - interval '3 minutes', 'conv_demo_wrongbranch',
   '{"turns": [{"role": "pharmacist", "text": "No love, this is the Mill Road branch."}]}',
   null, now() - interval '1 minute', null, now() - interval '6 minutes'),

  -- 10 expired (bucket 4): search settled before this one was ever dialed
  ('c0000000-0000-4000-8000-000000000001', 'FAKE10', 'expired',
   4, null, null, null, null, null, null, null, null, null, null,
   now() - interval '6 minutes')
on conflict (search_id, pharmacy_ods) do update set
  status = excluded.status, rank_bucket = excluded.rank_bucket,
  location_confirmed = excluded.location_confirmed,
  dial_mode = excluded.dial_mode,
  intended_number = excluded.intended_number,
  resolved_number = excluded.resolved_number,
  claimed_at = excluded.claimed_at,
  conversation_id = excluded.conversation_id,
  transcript = excluded.transcript, verdict = excluded.verdict,
  ended_at = excluded.ended_at, verdict_at = excluded.verdict_at,
  created_at = excluded.created_at;

commit;

-- Quick visual check (also proves the rows landed):
select p.name, c.status, c.rank_bucket,
       c.verdict->>'stock_status' as stock,
       c.verdict->>'quantity_available' as qty,
       to_char(c.verdict_at, 'HH24:MI') as confirmed_at
from calls c join pharmacies p on p.ods_code = c.pharmacy_ods
where c.search_id = 'c0000000-0000-4000-8000-000000000001'
order by c.rank_bucket nulls last, c.status;
