-- 4.1 settle + expiry — the deadline sweep (state machine v3 edge:
-- `queued → expired: search settled first`).
--
-- A search past its deadline_at gets every QUEUED child expired (bench
-- included). In-flight rows (dialing / transcript_ready) are NEVER killed:
-- their webhooks still record honest data; the search completes when the
-- last one terminates (drain-settle) or right here when nothing is in
-- flight. Advisory-locked on the same lock as the claim / promote / settle
-- writers — the sweep can never race a claim into a just-expired search.
create or replace function settle_expired_searches(p_at timestamptz default now())
returns table (expired_calls int, settled_searches int)
language plpgsql
as $$
declare
  l_expired int;
  l_settled int;
begin
  perform pg_advisory_xact_lock(880042);

  update calls c
    set status = 'expired', rank_bucket = 4
  from searches s
  where s.id = c.search_id
    and s.status = 'active'
    and s.deadline_at <= p_at
    and c.status = 'queued';
  get diagnostics l_expired = row_count;

  update searches s
    set status = 'complete', settled_at = p_at
  where s.status = 'active'
    and s.deadline_at <= p_at
    and not exists (
      select 1 from calls c
      where c.search_id = s.id and c.status in ('dialing', 'transcript_ready'));
  get diagnostics l_settled = row_count;

  expired_calls := l_expired;
  settled_searches := l_settled;
  return next;
end $$;

-- service-role only: the sweep is a command implementation detail
revoke execute on function settle_expired_searches(timestamptz) from public, anon, authenticated;
grant execute on function settle_expired_searches(timestamptz) to service_role;
