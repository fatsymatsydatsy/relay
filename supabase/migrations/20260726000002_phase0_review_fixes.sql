-- Phase 0 end-of-phase codex review fixes (see docs/review/ + build-steps.md).

-- P2: persist every verified webhook body verbatim, even when JSON parsing fails
alter table call_events add column raw_body text;

-- P2: transcripts are evidence — a transcript-bearing call row can never be deleted
create or replace function protect_call_evidence_delete() returns trigger
language plpgsql as $$
begin
  if old.transcript is not null then
    raise exception 'calls with transcripts are evidence and cannot be deleted';
  end if;
  return old;
end $$;

create trigger calls_no_evidence_delete
  before delete on calls
  for each row execute function protect_call_evidence_delete();

-- P2: strip inherited bootstrap privileges (TRUNCATE/TRIGGER/REFERENCES survive
-- additive grants and RLS does not guard TRUNCATE), then re-grant least-privilege.
revoke all on all tables in schema public from anon, authenticated;
grant select on pharmacies, medications, searches to anon, authenticated;
grant select (id, search_id, pharmacy_ods, status, rank_bucket, verdict,
              location_confirmed, is_bench, verdict_at, ended_at, created_at)
  on calls to anon, authenticated;
-- convention from here on: every new table gets its grants written explicitly
-- in its own migration; nothing relies on schema-level defaults.
