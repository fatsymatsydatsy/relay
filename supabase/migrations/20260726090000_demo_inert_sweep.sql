-- 4.6.1 (audit P1-1) — the deadline sweep must skip DEMO boards too.
--
-- DEMO fixtures are scenery: a queued row and a 14-minute deadline are part
-- of the story, not work to finish. The 4.1 sweep expired those rows and
-- completed the board ~14 minutes after creation — i.e. the video fallback
-- decayed while filming. The claim function already ignores DEMO; the sweep
-- now matches it. (`flip_cancel_non_terminal` was DEMO-safe from the start.)
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
    and s.dial_mode <> 'DEMO'
    and s.deadline_at <= p_at
    and c.status = 'queued';
  get diagnostics l_expired = row_count;

  update searches s
    set status = 'complete', settled_at = p_at
  where s.status = 'active'
    and s.dial_mode <> 'DEMO'
    and s.deadline_at <= p_at
    and not exists (
      select 1 from calls c
      where c.search_id = s.id and c.status in ('dialing', 'transcript_ready'));
  get diagnostics l_settled = row_count;

  expired_calls := l_expired;
  settled_searches := l_settled;
  return next;
end $$;

revoke execute on function settle_expired_searches(timestamptz) from public, anon, authenticated;
grant execute on function settle_expired_searches(timestamptz) to service_role;
