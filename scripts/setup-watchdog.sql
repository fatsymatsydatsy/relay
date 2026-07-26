-- 4.2 — schedule the watchdog tick: pg_cron calls the app route through
-- pg_net every 60 seconds. Run BY HAND against the CLOUD database (the
-- INTERNAL_SECRET cannot live in a committed migration):
--
--   psql "$CLOUD_DB_URL" \
--     -v url="'https://medfind-three.vercel.app/api/internal/watchdog'" \
--     -v secret="'<INTERNAL_SECRET from .env.local>'" \
--     -f scripts/setup-watchdog.sql
--
-- Re-running updates the existing job in place (same job name).
-- To pause:  select cron.unschedule('relay-watchdog');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'relay-watchdog',
  '* * * * *',
  format(
    $job$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', %L
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
    $job$,
    :url::text,
    :secret::text
  )
);

-- show what was scheduled (command intentionally not echoed — it embeds the secret)
select jobid, jobname, schedule, active from cron.job where jobname = 'relay-watchdog';
