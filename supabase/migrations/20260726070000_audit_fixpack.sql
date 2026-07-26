-- 3.7 audit fix-pack (docs/review/2026-07-26-phase-2-3-audit-codex.md).
-- P1-1 mode isolation · P1-2 validated stay-open hours in the claim ·
-- P1-3 atomic bench promotion + drain-settle · P1-5 attempt ceiling + age
-- gate · P1-6 hard cap ceilings · P2-3 bucket/payload matrix.

-- ── P1-1: a search carries its dial mode; demo boards are a mode of their own ─
-- Legacy rows backfill to DEV_TEST (every pre-3.7 search was a DEV_TEST or
-- demo board); old demo searches stay inert because the claim's new 20-minute
-- age gate refuses them. New demo searches write DEMO explicitly.
alter table searches add column dial_mode text not null default 'DEV_TEST'
  check (dial_mode in ('DEV_TEST', 'REAL', 'DEMO'));

-- ── P1-4: the FULL extraction output (notable quotes, verbatims) is evidence,
-- not UI data. Service-only: deliberately NOT added to the client column grant
-- on calls (init migration grants an explicit column list; this stays off it).
alter table calls add column extraction jsonb;

-- ── P2-3: bucket ↔ payload matrix. `is not distinct from` so a missing key or
-- null payload can never satisfy a stock bucket (CHECKs pass on NULL results —
-- the codex P2-3 bypass). NOT VALID: legacy cloud rows tolerated, every new
-- write enforced; prove-constraints.sql covers each mismatch (states 14–17).
alter table calls add constraint bucket_payload_matrix check (
  case
    when rank_bucket = 1 then (verdict ->> 'stock_status') is not distinct from 'in_stock'
    when rank_bucket = 2 then (verdict ->> 'stock_status') is not distinct from 'orderable'
    when rank_bucket = 3 then (verdict ->> 'stock_status') is not distinct from 'out_of_stock'
    else verdict is null or (verdict ->> 'stock_status') is not distinct from 'unclear'
  end
) not valid;

-- ── P1-2: fail-closed dialability. Mirrors lib/domain/opening-hours.ts
-- (validateHours + isOpenAt + staysOpenFor): ANY shape defect → never dial;
-- open now AND the session holds for p_stay_minutes; a 24:00 close continues
-- into a next-day 00:00 session. London wall-clock arithmetic — the known
-- spring-forward DST caveat is accepted and documented (audit P2-5, deferred).
create or replace function pharmacy_dialable(
  p_hours jsonb,
  p_at timestamptz default now(),
  p_stay_minutes int default 60
) returns boolean
language plpgsql
stable
as $$
declare
  l_local timestamp := p_at at time zone 'Europe/London';
  l_day text := lower(to_char(l_local, 'dy'));
  l_minutes int := extract(hour from l_local)::int * 60 + extract(minute from l_local)::int;
  l_days constant text[] := array['mon','tue','wed','thu','fri','sat','sun'];
  l_key text;
  l_val jsonb;
  l_session jsonb;
  l_open int;
  l_close int;
  l_remaining int;
  l_continuation int;
begin
  if p_hours is null or jsonb_typeof(p_hours) is distinct from 'object' then
    return false;
  end if;

  -- full validation first, every day, every session — fail closed on junk
  for l_key, l_val in select * from jsonb_each(p_hours) loop
    if not (l_key = any(l_days)) then return false; end if;
    if jsonb_typeof(l_val) is distinct from 'array' then return false; end if;
    for l_session in select * from jsonb_array_elements(l_val) loop
      if jsonb_typeof(l_session) is distinct from 'array'
         or jsonb_array_length(l_session) <> 2
         or jsonb_typeof(l_session -> 0) is distinct from 'string'
         or jsonb_typeof(l_session -> 1) is distinct from 'string'
         or (l_session ->> 0) !~ '^([01][0-9]|2[0-4]):([0-5][0-9])$'
         or (l_session ->> 1) !~ '^([01][0-9]|2[0-4]):([0-5][0-9])$' then
        return false;
      end if;
      l_open  := split_part(l_session ->> 0, ':', 1)::int * 60 + split_part(l_session ->> 0, ':', 2)::int;
      l_close := split_part(l_session ->> 1, ':', 1)::int * 60 + split_part(l_session ->> 1, ':', 2)::int;
      if l_open > 1440 or l_close > 1440 or l_open >= l_close then
        return false;
      end if;
    end loop;
  end loop;

  -- open now + stays open
  for l_session in select * from jsonb_array_elements(coalesce(p_hours -> l_day, '[]'::jsonb)) loop
    l_open  := split_part(l_session ->> 0, ':', 1)::int * 60 + split_part(l_session ->> 0, ':', 2)::int;
    l_close := split_part(l_session ->> 1, ':', 1)::int * 60 + split_part(l_session ->> 1, ':', 2)::int;
    if l_minutes >= l_open and l_minutes < l_close then
      l_remaining := l_close - l_minutes;
      if l_close = 1440 then
        select max(split_part(s ->> 1, ':', 1)::int * 60 + split_part(s ->> 1, ':', 2)::int)
          into l_continuation
          from jsonb_array_elements(
            coalesce(p_hours -> l_days[(array_position(l_days, l_day) % 7) + 1], '[]'::jsonb)
          ) s
          where split_part(s ->> 0, ':', 1)::int * 60 + split_part(s ->> 0, ':', 2)::int = 0;
        l_remaining := l_remaining + coalesce(l_continuation, 0);
      end if;
      if l_remaining >= p_stay_minutes then
        return true;
      end if;
    end if;
  end loop;
  return false;
end $$;

-- ── P1-3: bench promotion + drain-settle become atomic, serialized with the
-- claim on the SAME advisory lock (880042). One dead call promotes exactly one
-- replacement; settle can never read the bench mid-promotion.
create or replace function promote_bench(p_search_id uuid)
returns uuid
language plpgsql
as $$
declare
  l_id uuid;
begin
  perform pg_advisory_xact_lock(880042);
  update calls
    set is_bench = false
    where id = (
      select id from calls
      where search_id = p_search_id
        and status = 'queued'
        and is_bench = true
      order by rank_score desc nulls last, created_at asc
      limit 1
      for update skip locked
    )
    and status = 'queued'
    returning id into l_id;
  return l_id;
end $$;

create or replace function settle_if_drained(p_search_id uuid, p_at timestamptz default now())
returns boolean
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(880042);
  if exists (
    select 1 from calls
    where search_id = p_search_id
      and (status in ('dialing', 'transcript_ready')
        or (status = 'queued' and is_bench = false))
  ) then
    return false;
  end if;
  update calls
    set status = 'expired', rank_bucket = 4
    where search_id = p_search_id and status = 'queued' and is_bench = true;
  update searches
    set status = 'complete', settled_at = p_at
    where id = p_search_id and status = 'active';
  return true;
end $$;

-- ── the claim, v2 — P1-1/P1-2/P1-5/P1-6 all land INSIDE the lock ─────────────
create or replace function claim_next_dials(
  p_global_cap int,
  p_dial_mode text,
  p_per_search_cap int default 3,
  p_at timestamptz default now()
)
returns table (
  call_id uuid,
  search_id uuid,
  pharmacy_ods text,
  pharmacy_name text,
  pharmacy_address text,
  pharmacy_phone text,
  pharmacy_verified boolean,
  pharmacy_source text,
  medication_display text,
  quantity_needed int
)
language plpgsql
as $$
declare
  -- P1-6: the caps are DATABASE ceilings — a misconfigured caller can only
  -- lower them, never raise them past 8 global / 3 per search.
  l_global_cap int := least(coalesce(p_global_cap, 8), 8);
  l_search_cap int := least(coalesce(p_per_search_cap, 3), 3);
  -- P1-5: the ~12-attempt politeness budget (locked bench model). Counts
  -- dial_log rows that could have rung a pharmacy (reserved/connected);
  -- definite pre-ring rejections (freed) never ate anyone's time.
  l_attempt_ceiling constant int := 12;
  l_global_inflight int;
  l_candidate record;
begin
  if p_dial_mode not in ('DEV_TEST', 'REAL') then
    raise exception 'unknown dial mode %', p_dial_mode;
  end if;

  -- ONE claimer at a time, transaction-scoped
  perform pg_advisory_xact_lock(880042);

  -- P1-1: demo-board rows never consume real capacity
  select count(*) into l_global_inflight
  from calls c
  join searches s on s.id = c.search_id
  where c.status = 'dialing' and s.dial_mode <> 'DEMO';

  for l_candidate in
    select c.id as call_id, c.search_id, c.pharmacy_ods,
           p.name, p.address, p.phone, p.verified, p.source,
           m.display as medication_display, s.quantity_needed
    from calls c
    join searches s on s.id = c.search_id
    join pharmacies p on p.ods_code = c.pharmacy_ods
    join medications m on m.id = s.medication_id
    where c.status = 'queued'
      and c.is_bench = false
      and s.status = 'active'
      -- P1-1: a search only ever dials in the mode it was created for
      and s.dial_mode = p_dial_mode
      -- P1-5: claims stop when the search's 20-minute window is over
      and s.created_at > p_at - interval '20 minutes'
      -- P1-2: validated hours, open now, AND stays open the full horizon
      and pharmacy_dialable(p.hours, p_at, 60)
      -- mode gates: politeness by data, verified-only in REAL (also 4.5)
      and ((p_dial_mode = 'DEV_TEST' and p.source = 'dev_test')
        or (p_dial_mode = 'REAL' and p.verified and p.source <> 'dev_test'))
      -- the one-dial-per-number-per-hour rule (freed rows stop blocking)
      and not exists (
        select 1 from dial_log d
        where d.phone = p.phone
          and d.outcome in ('reserved', 'connected')
          and d.dialed_at > p_at - interval '1 hour')
      -- per-search cap
      and (select count(*) from calls c2
           where c2.search_id = c.search_id and c2.status = 'dialing') < l_search_cap
      -- P1-5: per-search attempt ceiling
      and (select count(*) from dial_log dl
           join calls ca on ca.id = dl.call_id
           where ca.search_id = c.search_id
             and dl.outcome in ('reserved', 'connected')) < l_attempt_ceiling
    order by
      -- fairness: the search with the fewest calls in flight goes first…
      (select count(*) from calls c3
       where c3.search_id = c.search_id and c3.status = 'dialing') asc,
      -- …then the best-ranked pharmacy within it
      c.rank_score desc nulls last,
      c.created_at asc
  loop
    exit when l_global_inflight >= l_global_cap;

    -- The candidate list is a snapshot: OUR OWN claims in this loop change
    -- the counts, so the per-search cap, the per-number rule, and the attempt
    -- ceiling must be re-checked live before every claim (dispatch.stress).
    if (select count(*) from calls c4
        where c4.search_id = l_candidate.search_id
          and c4.status = 'dialing') >= l_search_cap then
      continue;
    end if;
    if exists (
        select 1 from dial_log d2
        where d2.phone = l_candidate.phone
          and d2.outcome in ('reserved', 'connected')
          and d2.dialed_at > p_at - interval '1 hour') then
      continue;
    end if;
    if (select count(*) from dial_log dl2
        join calls ca2 on ca2.id = dl2.call_id
        where ca2.search_id = l_candidate.search_id
          and dl2.outcome in ('reserved', 'connected')) >= l_attempt_ceiling then
      continue;
    end if;

    update calls
      set status = 'dialing',
          claimed_at = p_at,
          dial_mode = p_dial_mode,
          intended_number = l_candidate.phone
      where id = l_candidate.call_id and status = 'queued';
    if not found then
      continue; -- lost a race with a webhook transition; skip
    end if;

    insert into dial_log (phone, medication_id, call_id, outcome, dialed_at)
    select l_candidate.phone, s.medication_id, l_candidate.call_id, 'reserved', p_at
    from searches s where s.id = l_candidate.search_id;

    l_global_inflight := l_global_inflight + 1;

    call_id := l_candidate.call_id;
    search_id := l_candidate.search_id;
    pharmacy_ods := l_candidate.pharmacy_ods;
    pharmacy_name := l_candidate.name;
    pharmacy_address := l_candidate.address;
    pharmacy_phone := l_candidate.phone;
    pharmacy_verified := l_candidate.verified;
    pharmacy_source := l_candidate.source;
    medication_display := l_candidate.medication_display;
    quantity_needed := l_candidate.quantity_needed;
    return next;
  end loop;
end $$;

-- service-role only: commands are the only writers
revoke execute on function pharmacy_dialable(jsonb, timestamptz, int) from public, anon, authenticated;
revoke execute on function promote_bench(uuid) from public, anon, authenticated;
revoke execute on function settle_if_drained(uuid, timestamptz) from public, anon, authenticated;
grant execute on function pharmacy_dialable(jsonb, timestamptz, int) to service_role;
grant execute on function promote_bench(uuid) to service_role;
grant execute on function settle_if_drained(uuid, timestamptz) to service_role;
