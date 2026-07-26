# MedFind — Architecture Review Packet (pre-implementation)

48h hackathon build. Nothing is implemented yet — this reviews the design. PRD: `/Users/marvin/Downloads/medfind-prd.md`. Full explainer: `medfind-explainer.html` (same dir).

## Product

Patient enters medication (exact strength/form) + UK postcode + radius. An ElevenLabs voice agent really phones every open pharmacy in radius (max 2–3 concurrent per search), asks about stock, results stream live to the browser, ranked. Anonymous, no payments, England only. Demo must run REAL calls on judging day.

## Fixed stack

Next.js App Router on Vercel (serverless — no long-lived process) · Supabase Postgres + realtime · ElevenLabs agents + Twilio native integration (Creator plan = 10 concurrent conversations workspace-wide) · Claude API for transcript→JSON. Only other service under consideration: postcodes.io for postcode→lat/lng (+ bundled demo-area fallback).

## Core model

Postgres is the single source of truth; small commands are the only writers; UI is a realtime projection of the tables. Every call is a row with a status.

### Tables

`medications` (dm+d seed) · `pharmacies` (ODSCode PK, phone E.164, lat/lng, per-day opening sessions incl. lunch, verified flag, source) · `searches` · `calls` (status machine, conversation_id, callSid, raw transcript, verdict jsonb, rank bucket, retry_due_at) · `call_events` (append-only webhook log) · `dial_log` (number, dialed_at — feeds the 1-hour rule).

### Commands (stateless functions: wake on trigger → touch tables → exit)

| Command | Trigger | Job |
|---|---|---|
| create_search | user clicks Search | validate med; geocode; snapshot open pharmacies in radius from OUR table; queue ~12 nearest as `queued` rows; copy any <1h same-pharmacy+same-med cached verdict instead of queueing; zero open → queue nothing, show next opening times |
| dispatch | search created · any call terminal · watchdog | ONE atomic SQL claim enforcing ALL invariants: ≤3 in-flight per search, ≤GLOBAL_CAP(8) total, number absent from dial_log in last hour, retry_due_at <= now(), pharmacy open right now, fairness = fewest-in-flight search first; then POST per winner to ElevenLabs outbound-call; mark `dialing`, store conversation_id+callSid from response |
| record_call_event | ElevenLabs webhook | verify HMAC (ElevenLabs-Signature); append raw payload to call_events; advance call status; return 200 fast; then invoke dispatch (slot freed) + extract_result (if transcript) + settle check |
| extract_result | transcript stored | stored transcript → Claude w/ JSON schema → verdict {stock yes/no/unclear, qty, orderable, eta, hold, location_confirmed, voicemail_flag} + rank bucket → write on call row (realtime pushes to browser) |
| settle_search | any call terminal · watchdog | if no non-terminal calls remain OR search age > 20 min → mark search complete |
| check_capacity | search form (P2) | read-only: queue depth ÷ drain rate → green/amber/red ETA banner |
| seed_pharmacies | manual, build time | NHS Service Search API v3 → normalize → upsert pharmacies by ODSCode |

### Call state machine

queued → dialing → talking → transcript_ready → verdict (terminal)
queued → skipped (closed at dial time, terminal)
dialing → unreached (30s ring / busy / voicemail)
talking → wrong_location (branch check failed, terminal)
unreached → queued (ONE retry, retry_due_at = +10 min, only within opening hours) | → unreachable (terminal)

Rank buckets: 1 in-stock (qty) → 2 orderable (soonest ETA) → 3 no stock → 4 unreached/unverified/wrong-branch. Bucket 4 may never render as a stock verdict (PRD hard rule). All idempotency via UPDATE … WHERE status = expected (webhooks are at-least-once).

## Event model (no polling)

- Call ends w/ conversation → `post_call_transcription` webhook (transcript turns, analysis, metadata).
- Call never connects → `call_initiation_failure` webhook (failure_reason: busy/no-answer/unknown).
- Webhook handler invokes dispatch (refill slot) synchronously after 200.
- Retries + 1-hour lapses: predicate in the claim query, evaluated on every event.
- 1-min watchdog cron ONLY for silences: lost webhooks, dead-quiet searches hitting the 20-min timeout. It acting = logged anomaly.

## Integration facts (verified July 2026)

- Outbound: `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call`, header `xi-api-key`; body agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data.dynamic_variables ({{pharmacy_name}}, {{street}}, {{medication}} → templated greeting incl. branch-identity check "Is this the X pharmacy on Y street?"). Response: success, conversation_id, callSid.
- ElevenLabs system tools: DTMF keypad (IVR nav), voicemail detection (end call), end call. 5-min per-call budget, 30s ring timeout.
- Webhooks HMAC-signed; must return 200 fast; auto-disabled after ~10 consecutive failures (would silently freeze all searches).
- Concurrency: Creator plan 10 concurrent workspace-wide (incl. dashboard test calls). GLOBAL_CAP=8 self-imposed headroom. Over-cap rejection → call row flips back to queued. Burst pricing opt-in: 3× cap at $0.16/min (vs $0.08).
- Twilio: 1 new call/sec origination default (queues over-rate), concurrency effectively unbounded, bills from answer (unanswered ring free; voicemail pickup = answered = billed).
- Costs: real 3.5-min call ≈ $0.35–0.40 all-in; 6-pharmacy search ≈ $2–3.

## Pharmacy data

NHS Service Search API v3 (`POST api.service.nhs.uk/service-search-api/search?api-version=3`, API key, sandbox available; filter OrganisationTypeId eq 'PHA' and OrganisationSubType eq 'Community' — excludes internet-only). Ingested once at build; demo-area numbers hand-verified by team calls. Geographic numbers (01/02) preferred; 03/08 national lines flagged/excluded. Store-selection IVRs out of scope (agent bails, flags number). Searches never hit the NHS API live.

## Capacity math (user-confirmed 3.5-min avg calls)

20-min search timeout ÷ 3.5 ≈ 5 waves × 3 concurrent = 15 calls max/search → queue capped at ~12 (retry headroom). First result ≈ 4 min. 6-pharmacy search ≈ 7–8 min. At cap 8: ~2.3 calls/min ≈ 22 six-pharmacy searches/hr; ~7 truly-simultaneous searches before overload tier. Retry at +10 min fits exactly one retry wave inside 20 min.

## Honesty/safety (PRD non-negotiables)

Agent discloses automation when asked; never impersonates. Postcode only, no PII. Verdicts timestamped ("confirmed by phone at 14:32"), never reservations. Unanswered ≠ verdict. Etiquette: ≤1 call/number/hour globally, never call closed pharmacies, one follow-up max. Required disclaimer (not medical advice, 999/111). DEV_TEST mode: resolveDialNumber() reroutes all dials to team phones; REAL mode for judging.

## Known open items (do NOT report these as findings)

Companion `pharmacy-call-agent-script.md` not yet available (authoritative agent behavior + extraction schema). NHS API key onboarding day-0. postcodes.io sign-off pending. Demo-area number verification pending. Burst pricing toggle before judging.

## Review ask

Find gaps that will become bugs/incidents: race conditions & concurrency holes, webhook ordering/duplication/correlation failures, state machine dead-ends, schema omissions, invariant leaks, PRD requirements not structurally covered, integration wrong-assumptions, capacity/cost math errors, security/privacy holes (HMAC, RLS/anon realtime access, PII), and demo-day failure modes. Ranked findings, each: title · severity (high/med/low) · concrete breaking scenario · suggested fix. Skip style opinions and the known open items.
