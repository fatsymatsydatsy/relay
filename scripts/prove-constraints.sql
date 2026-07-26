-- 0.2.2 constraint proof — every block attempts a FORBIDDEN state and passes
-- only if the database rejects it. Run: psql <db-url> -f scripts/prove-constraints.sql
-- Output must end with: ALL 6 FORBIDDEN STATES REJECTED

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
begin
  -- 1) stock verdict without confirmed branch
  begin
    insert into calls (search_id, pharmacy_ods, status, rank_bucket, verdict, location_confirmed)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'verdict', 1, '{"stock":"in_stock"}', 'no');
    raise exception 'FORBIDDEN STATE 1 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 2) stock verdict on a non-verdict status
  begin
    insert into calls (search_id, pharmacy_ods, status, rank_bucket, verdict, location_confirmed)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'dialing', 2, '{"stock":"out_of_stock"}', 'yes');
    raise exception 'FORBIDDEN STATE 2 ACCEPTED';
  exception when check_violation then rejected := rejected + 1;
  end;

  -- 3) unreached call carrying a stock payload
  begin
    insert into calls (search_id, pharmacy_ods, status, verdict)
    values ('00000000-0000-0000-0000-00000000aaaa', 'TEST1', 'unreached', '{"stock":"in_stock"}');
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

  if rejected = 6 then
    raise notice 'ALL 6 FORBIDDEN STATES REJECTED';
  else
    raise exception 'ONLY % OF 6 FORBIDDEN STATES REJECTED', rejected;
  end if;
end $$;

rollback;
