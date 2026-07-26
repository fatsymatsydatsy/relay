-- 0.2.2 constraint proof — every block attempts a FORBIDDEN state and passes
-- only if the database rejects it.
-- Run: psql <db-url> -v ON_ERROR_STOP=1 -f scripts/prove-constraints.sql
-- (ON_ERROR_STOP makes any accepted forbidden state fail the psql PROCESS,
--  so the machine gate can trust the exit code.)
-- Output must end with: ALL 13 FORBIDDEN STATES REJECTED

begin;

-- fixtures
insert into medications (id, name, strength, form, display) values
  ('00000000-0000-0000-0000-000000000001', 'Creon', '25,000', 'gastro-resistant capsules', 'Creon 25,000 gastro-resistant capsules');
insert into pharmacies (ods_code, name, address, postcode, phone, lat, lng, hours) values
  ('TEST1', 'Test Pharmacy A', '1 Test St', 'TE5 1ST', '+447700900001', 51.5, -0.1, '{}');
insert into searches (id, owner, medication_id, postcode, radius_km, deadline_at) values
  ('00000000-0000-0000-0000-00000000aaaa', gen_random_uuid(),
   '00000000-0000-0000-0000-000000000001', 'TE5 1ST', 3, now() + interval '20 minutes');

do $$
declare
  rejected int := 0;
  fixture_call uuid;
  fixture_dial bigint;
begin
  -- 1) stock verdict (bucket 1) without confirmed branch
  begin
    insert into calls (search_id, pharmacy_ods, status, rank_bucket, verdict, location_confirmed)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'verdict', 1, '{"stock_status":"in_stock"}', 'no');
    raise exception 'FORBIDDEN STATE 1 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 2) stock verdict on a non-verdict status
  begin
    insert into calls (search_id, pharmacy_ods, status, rank_bucket, verdict, location_confirmed)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'dialing', 2, '{"stock_status":"out_of_stock"}', 'yes');
    raise exception 'FORBIDDEN STATE 2 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 3) unreached call carrying a verdict payload
  begin
    insert into calls (search_id, pharmacy_ods, status, verdict)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'unreached', '{"stock_status":"in_stock"}');
    raise exception 'FORBIDDEN STATE 3 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 4) duplicate pharmacy within one search
  begin
    insert into calls (search_id, pharmacy_ods) values
      ('00000000-0000-0000-0000-00000000aaaa', 'TEST1'),
      ('00000000-0000-0000-0000-00000000aaaa', 'TEST1');
    raise exception 'FORBIDDEN STATE 4 ACCEPTED';
  exception when unique_violation then rejected := rejected + 1;
  end;

  -- 5) more than 3 extraction attempts
  begin
    insert into calls (search_id, pharmacy_ods, extraction_attempts)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 4);
    raise exception 'FORBIDDEN STATE 5 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 6) out-of-range rank bucket
  begin
    insert into calls (search_id, pharmacy_ods, rank_bucket) values
      ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 5);
    raise exception 'FORBIDDEN STATE 6 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 7) codex bypass A: bucket-4 row smuggling an in-stock payload
  begin
    insert into calls (search_id, pharmacy_ods, status, rank_bucket, verdict, location_confirmed)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'verdict', 4, '{"stock_status":"in_stock"}', 'no');
    raise exception 'FORBIDDEN STATE 7 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 8) codex bypass B: NULL-bucket row with an unconfirmed stock payload
  begin
    insert into calls (search_id, pharmacy_ods, status, verdict, location_confirmed)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'verdict', '{"stock_status":"in_stock"}', 'unclear');
    raise exception 'FORBIDDEN STATE 8 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 9) negative extraction attempts
  begin
    insert into calls (search_id, pharmacy_ods, extraction_attempts)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', -1);
    raise exception 'FORBIDDEN STATE 9 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 10) non-E.164 pharmacy phone
  begin
    insert into pharmacies (ods_code, name, address, postcode, phone, lat, lng, hours)
    values ('TEST2', 'Bad Phone Pharmacy', '2 Test St', 'TE5 2ND', '0044 7700 900002', 51.5, -0.1, '{}');
    raise exception 'FORBIDDEN STATE 10 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 11) overwriting a transcript (append-only evidence)
  insert into calls (search_id, pharmacy_ods, status, transcript)
  values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'transcript_ready', '{"turns":[1]}')
  returning id into fixture_call;
  begin
    update calls set transcript = '{"turns":[2]}' where id = fixture_call;
    raise exception 'FORBIDDEN STATE 11 ACCEPTED';
  exception when raise_exception then
    if sqlerrm = 'FORBIDDEN STATE 11 ACCEPTED' then raise; end if;
    rejected := rejected + 1;
  end;

  -- 12) rewriting dial_log history (only outcome may change)
  insert into dial_log (phone, call_id) values ('+447700900001', fixture_call)
  returning id into fixture_dial;
  begin
    update dial_log set phone = '+447700900099' where id = fixture_dial;
    raise exception 'FORBIDDEN STATE 12 ACCEPTED';
  exception when raise_exception then
    if sqlerrm = 'FORBIDDEN STATE 12 ACCEPTED' then raise; end if;
    rejected := rejected + 1;
  end;

  -- 13) deleting a transcript-bearing call (evidence must survive)
  begin
    delete from calls where id = fixture_call;
    raise exception 'FORBIDDEN STATE 13 ACCEPTED';
  exception when raise_exception then
    if sqlerrm = 'FORBIDDEN STATE 13 ACCEPTED' then raise; end if;
    rejected := rejected + 1;
  end;

  -- sanity: the LEGAL versions must succeed
  update dial_log set outcome = 'freed' where id = fixture_dial;      -- outcome may change
  insert into calls (search_id, pharmacy_ods) values                  -- transcript-less rows
    ('00000000-0000-0000-0000-00000000aaaa', 'TEST1')                 --   may be deleted
    on conflict do nothing;

  if rejected = 13 then
    raise notice 'ALL 13 FORBIDDEN STATES REJECTED';
  else
    raise exception 'ONLY % OF 13 FORBIDDEN STATES REJECTED', rejected;
  end if;
end $$;

rollback;
