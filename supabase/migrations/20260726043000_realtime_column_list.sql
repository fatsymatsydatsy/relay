-- 1.5 realtime hardening: realtime broadcasts whole rows — SELECT column
-- grants do NOT apply to the replication stream — so publishing `calls`
-- unrestricted would push raw transcripts to subscribed clients, violating
-- the invariant "client never receives raw transcripts". A publication
-- column list (PG15+) limits the WAL payload to exactly the client-granted
-- columns. RLS (WALRUS) still scopes rows to the owner.

alter publication supabase_realtime drop table calls;
alter publication supabase_realtime add table calls (
  id, search_id, pharmacy_ods, status, rank_bucket, verdict,
  location_confirmed, is_bench, verdict_at, ended_at, created_at
);
