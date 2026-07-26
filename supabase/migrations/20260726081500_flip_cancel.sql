-- 4.5 DEV_TEST → REAL flip — the cancel sweep.
--
-- 3.7's mode isolation already removes the DIAL risk (a REAL claim can only
-- see REAL searches and verified real pharmacies); this sweep is board
-- hygiene for the flip ritual: every non-terminal row of every non-DEMO
-- search expires and those searches complete, so the moment of the flip
-- starts from a visibly clean slate. DEMO boards are inert and stay alive.
-- Advisory-locked: a flip can never race a claim.
create or replace function flip_cancel_non_terminal(p_at timestamptz default now())
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
    and s.dial_mode <> 'DEMO'
    and c.status in ('queued', 'dialing', 'transcript_ready');
  get diagnostics l_expired = row_count;

  update searches s
    set status = 'complete', settled_at = p_at
  where s.status = 'active'
    and s.dial_mode <> 'DEMO';
  get diagnostics l_settled = row_count;

  expired_calls := l_expired;
  settled_searches := l_settled;
  return next;
end $$;

revoke execute on function flip_cancel_non_terminal(timestamptz) from public, anon, authenticated;
grant execute on function flip_cancel_non_terminal(timestamptz) to service_role;
