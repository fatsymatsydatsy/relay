-- 3.2 dispatch — THE single advisory-locked claim function. Every dialing
-- invariant lives HERE and nowhere else (CLAUDE.md):
--   ≤3 calls in flight per search · ≤p_global_cap in flight globally ·
--   one dial per pharmacy number per hour (dial_log) · never a closed
--   pharmacy (Europe/London wall clock) · only active searches ·
--   REAL mode: verified, non-test pharmacies only · DEV_TEST mode: test-data
--   pharmacies only (politeness by DATA, never by switched-off rules) ·
--   fairness: searches with fewest in-flight calls first, then rank_score.
--
-- Concurrent invocations serialize on pg_advisory_xact_lock, so caps can
-- never overshoot (designed-out bug: dispatch.stress).

-- London-wall-clock open-now check against the hours jsonb convention
-- ({"mon": [["09:00","18:00"]], ...}; "24:00" = end of day).
create or replace function pharmacy_open_now(p_hours jsonb, p_at timestamptz default now())
returns boolean
language plpgsql
stable
as $$
declare
  l_local timestamp := p_at at time zone 'Europe/London';
  l_day text := lower(to_char(l_local, 'dy'));
  l_minutes int := extract(hour from l_local)::int * 60 + extract(minute from l_local)::int;
  l_session jsonb;
  l_open int;
  l_close int;
begin
  if p_hours is null or jsonb_typeof(p_hours -> l_day) is distinct from 'array' then
    return false;
  end if;
  for l_session in select * from jsonb_array_elements(p_hours -> l_day) loop
    begin
      l_open := split_part(l_session ->> 0, ':', 1)::int * 60 + split_part(l_session ->> 0, ':', 2)::int;
      l_close := split_part(l_session ->> 1, ':', 1)::int * 60 + split_part(l_session ->> 1, ':', 2)::int;
    exception when others then
      continue; -- junk session shapes never open a pharmacy
    end;
    if l_minutes >= l_open and l_minutes < l_close then
      return true;
    end if;
  end loop;
  return false;
end $$;

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
  l_global_inflight int;
  l_candidate record;
begin
  if p_dial_mode not in ('DEV_TEST', 'REAL') then
    raise exception 'unknown dial mode %', p_dial_mode;
  end if;

  -- ONE claimer at a time, transaction-scoped
  perform pg_advisory_xact_lock(880042);

  select count(*) into l_global_inflight from calls where status = 'dialing';

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
      and pharmacy_open_now(p.hours, p_at)
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
           where c2.search_id = c.search_id and c2.status = 'dialing') < p_per_search_cap
    order by
      -- fairness: the search with the fewest calls in flight goes first…
      (select count(*) from calls c3
       where c3.search_id = c.search_id and c3.status = 'dialing') asc,
      -- …then the best-ranked pharmacy within it
      c.rank_score desc nulls last,
      c.created_at asc
  loop
    exit when l_global_inflight >= p_global_cap;

    -- The candidate list is a snapshot: OUR OWN claims in this loop change
    -- the counts, so the per-search cap and the per-number rule must be
    -- re-checked live before every claim (dispatch.stress covers this).
    if (select count(*) from calls c4
        where c4.search_id = l_candidate.search_id
          and c4.status = 'dialing') >= p_per_search_cap then
      continue;
    end if;
    if exists (
        select 1 from dial_log d2
        where d2.phone = l_candidate.phone
          and d2.outcome in ('reserved', 'connected')
          and d2.dialed_at > p_at - interval '1 hour') then
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

-- service-role only: the claim is a command implementation detail
revoke execute on function pharmacy_open_now(jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function claim_next_dials(int, text, int, timestamptz) from public, anon, authenticated;
grant execute on function pharmacy_open_now(jsonb, timestamptz) to service_role;
grant execute on function claim_next_dials(int, text, int, timestamptz) to service_role;
