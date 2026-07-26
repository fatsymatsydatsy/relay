-- 5.2h — cron doctor + reschedule (the watchdog cron has never fired:
-- canary survived 3.5 min, manual tick swept instantly; the 4.2 setup
-- depended on a by-hand psql run that failed on $CLOUD_DB_URL and was never
-- confirmed from the dashboard. cron.job isn't PostgREST-visible, so this
-- migration adds two SERVICE-ROLE-ONLY functions to see and fix it via RPC
-- — no dashboard round-trips, and the secret never lands in the repo:
-- it's passed as an argument at call time.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- What is scheduled, did it run, what did the HTTP layer say — with the
-- job command EXCLUDED everywhere (it embeds the secret).
create or replace function cron_doctor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs jsonb;
  v_runs jsonb;
  v_http jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'jobid', jobid, 'jobname', jobname, 'schedule', schedule,
      'active', active, 'database', database, 'username', username)), '[]'::jsonb)
    into v_jobs
    from cron.job;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_runs from (
    select jsonb_build_object(
        'jobid', jobid, 'status', status, 'return_message', return_message,
        'start_time', start_time, 'end_time', end_time) as r
      from cron.job_run_details
      order by start_time desc
      limit 8
  ) recent;

  begin
    select coalesce(jsonb_agg(h), '[]'::jsonb) into v_http from (
      select jsonb_build_object(
          'id', id, 'status_code', status_code, 'timed_out', timed_out,
          'error_msg', error_msg, 'created', created) as h
        from net._http_response
        order by created desc
        limit 8
    ) recent_http;
  exception when others then
    v_http := to_jsonb('net._http_response unreadable: ' || sqlerrm);
  end;

  return jsonb_build_object('jobs', v_jobs, 'recent_runs', v_runs, 'recent_http', v_http);
end $$;

-- Unschedule every relay watchdog job and schedule a correct one. Tries the
-- 30-second granularity (pg_cron >= 1.5); falls back to every-minute.
create or replace function cron_reschedule(
  p_secret text,
  p_url text default 'https://medfind-three.vercel.app/api/internal/watchdog'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_jobid bigint;
  v_schedule text := '30 seconds';
  v_command text;
begin
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'refusing: secret missing or too short';
  end if;

  for r in select jobname from cron.job where jobname like 'relay-watchdog%' loop
    perform cron.unschedule(r.jobname);
  end loop;

  v_command := format(
    $job$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 25000);$job$,
    p_url, p_secret);

  begin
    select cron.schedule('relay-watchdog', v_schedule, v_command) into v_jobid;
  exception when others then
    v_schedule := '* * * * *';
    select cron.schedule('relay-watchdog', v_schedule, v_command) into v_jobid;
  end;

  return jsonb_build_object('jobid', v_jobid, 'schedule', v_schedule, 'url', p_url);
end $$;

-- Service role only — these read cron state and take a secret argument.
revoke all on function cron_doctor() from public, anon, authenticated;
revoke all on function cron_reschedule(text, text) from public, anon, authenticated;
grant execute on function cron_doctor() to service_role;
grant execute on function cron_reschedule(text, text) to service_role;
