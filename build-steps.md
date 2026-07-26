# MedFind — Build Steps (living state file)

> **This file is the single source of "where are we."** Every session reads it first; every step's
> status changes here, in real time. Protocol in CLAUDE.md §Status protocol.

## Status legend

| Mark | Meaning |
|---|---|
| `[ ]` | not started |
| `[~]` | in progress (mark BEFORE starting work) |
| `[?]` | built + machine-green, **awaiting Marvin's approval** (human-gated items only) |
| `[x]` | done (criteria met, approved where required, committed) |

**Oracle labels:** 🤖 = machine-gated (Claude verifies alone: tests, builds, scripted checks) · 🧑 = human-gated (Marvin/teammates must check — step parks at `[?]` until approval).

**Rules:** one step in progress per track · a step starts only when the previous step in its track is `[x]` · commit per step · sub-step criteria are written here BEFORE the sub-step is built — if a criterion changes, change it in this file first.

## Locked decisions (do not re-litigate mid-build)

Postgres is truth, commands are the only writers, UI is a projection · no retries — bench model (target 6 answered, 3 lines, ~12-attempt ceiling) · agent = "assistant calling on behalf of a patient," truthful if asked whether automated · quantity never disqualifies · no hold requests · extraction = OpenAI `gpt-5.4-mini` (escalate `gpt-5.6-sol` after 2 schema failures) · watchdog = Supabase pg_cron · politeness rules are never bypassed in code — test DATA does the work (fake 24/7 pharmacies).

## Designed-out bugs (from the adversarial review → named tests)

| Past finding | The test that proves it's out |
|---|---|
| Concurrent dispatch overshoots caps / double-dials | `dispatch.stress` (2.x/3.2) |
| Webhook arrives before conversation_id saved | correlation-by-`call_ref` test (0.4) |
| BST off-by-one dials closed pharmacy | `hours.bst-boundary` (2.1) |
| Wrong branch renders as stock | `bucket.wrong-location` (2.3) |
| Duplicate webhook double-processes | `webhook.idempotent` (3.3) |
| Lost webhook eats a slot forever | `watchdog.reconcile` (4.2) |
| Anonymous visitor reads others' searches | `rls.two-sessions` (4.3) |
| Stale DEV rows dial real pharmacies after flip | `flip.cancels` (4.5) |

---

## Phase 0 — Walking skeleton + the scariest seam, alone (~2h)

*Per how-we-work §2: prove the architecture end-to-end with zero domain logic before building on it. Our scariest seam is Vercel↔ElevenLabs↔Twilio↔Supabase — it gets a tracer bullet FIRST.*

- [~] **0.1 Repo scaffold** 🤖
  - [~] 0.1.1 Next.js (App Router, TS) scaffold matching the approved tree → passes when: `npm run build` green, folder tree matches the approved structure.
  - [ ] 0.1.2 git init + first commit + `.env.example` naming every key → passes when: `git log` shows commit; `.env.local` is ignored (`git status` clean with it present).
  - **Step success:** fresh `npm install && npm run build` green from a clean checkout.

- [ ] **0.2 Database schema v1** 🤖
  - [ ] 0.2.1 Migrations: `medications, pharmacies, searches, calls, call_events, dial_log` with status enums, `unique(search_id, pharmacy_id)`, CHECK constraints (no stock verdict without confirmed branch) → passes when: migration applies cleanly to a fresh database.
  - [ ] 0.2.2 Constraint proof script: attempts 5 forbidden inserts (bucket-1 without `location_confirmed`, duplicate pharmacy per search, etc.) → passes when: all 5 are REJECTED by the database itself.
  - **Step success:** schema up + all forbidden-state inserts bounce.

- [ ] **0.3 Deployed shell** 🤖 + 🧑
  - [ ] 0.3.1 Vercel project + env vars + deploy → passes when: 🤖 prod URL returns 200.
  - [ ] 0.3.2 Placeholder page reads a count from the DB → passes when: 🧑 Marvin opens the URL and sees "MedFind — N pharmacies loaded."
  - **Step success:** the deployed site provably talks to the database.

- [ ] **0.4 TRACER BULLET — one real call, no logic** 🧑 *(the whole point of Phase 0)*
  - [ ] 0.4.1 Import Twilio number into ElevenLabs (SID + auth token) → passes when: 🧑 number shows "imported" in the ElevenLabs dashboard.
  - [ ] 0.4.2 Minimal agent (temporary config, not the full script) + dashboard test call → passes when: 🧑 Marvin's phone rings from the dashboard and he hears the voice.
  - [ ] 0.4.3 Outbound call via API from a script, `call_ref` in dynamic variables → passes when: 🤖 response contains `conversation_id` + `callSid`.
  - [ ] 0.4.4 Webhook route: HMAC verify → append raw to `call_events` → 200 → passes when: 🤖 a forged-signature POST gets 200 + log + NO row; a real webhook writes a row.
  - [ ] 0.4.5 End-to-end tracer: script dials Marvin, he answers, hangs up → passes when: 🤖 within 60s `call_events` holds a `post_call_transcription` row whose `call_ref` matches, with real transcript text. 🧑 Marvin confirms the transcript matches what he said.
  - **Step success:** the scary seam works end-to-end, correlated by OUR id, before any product logic exists.

---

## Phase 1 — Static UI on fake data (teammate's track, parallel from hour ~1)

*Zero backend risk; pure look-and-feel. All 🧑-gated on fidelity.*

- [ ] **1.1 Fake data seed** 🤖 — script inserts 1 fake search + 8 call rows covering every state and bucket → passes when: rows visible in Supabase Studio.
- [ ] **1.2 Search form** 🧑 — med (seeded shortage list), dosage, quantity, postcode, radius, NHS/private; disclaimer visible → passes when: 🧑 Marvin + teammate approve on phone AND desktop; submits to a stub.
- [ ] **1.3 Scoreboard on fake rows** 🧑 — every state visually distinct (queued · ringing · 3 verdict kinds · couldn't-reach · expired), timestamps ("confirmed by phone at 14:32"), partial-quantity display ("1 box — you need 2") → passes when: 🧑 bucket 4 is unmistakably NOT a stock verdict; disclaimer present; teammate + Marvin sign off.
- [ ] **1.4 Realtime proof** 🤖 + 🧑 — subscribe; manually UPDATE a row in SQL → passes when: board updates < 2s with no refresh (🧑 watches it happen).

---

## Phase 2 — Pure logic, headless, test-driven (parallel with Phase 1) (~1.5h)

*Test pyramid base: the rules live here, no network, no UI. All 🤖.*

- [ ] **2.1 Opening-hours module** 🤖 — parse per-day sessions; `isOpenNow`, `staysOpenFor(1h)`, all in Europe/London → passes when: unit tests green incl. `hours.bst-boundary` (18:30 London ≠ 17:30 UTC), lunch closure, midnight, 24/7 fake pharmacy.
- [ ] **2.2 Portfolio scorer** 🤖 — throw-out step → score (history/size/distance/answered) → constrained pick → passes when: `never >2 per chain` test green, ≥2 independents when available, closed/closing-soon always excluded, deterministic on fixture data.
- [ ] **2.3 Verdict schema + buckets** 🤖 — zod schema mirroring call-script §5 + bucket mapper → passes when: fixture verdicts validate; forbidden combos rejected; `bucket.wrong-location` green (wrong branch can never be buckets 1–3).
- [ ] **2.4 Dial resolution** 🤖 — `resolveDialNumber()` DEV_TEST/REAL + per-claim snapshot fields → passes when: both modes unit-tested; REAL refuses unverified pharmacies.

---

## Phase 3 — The vertical slice, then widen (~3h, my core block)

- [ ] **3.1 create_search** 🤖 — geocode (postcodes.io + bundled fallback) · scorer · queue top-6 + bench · cached-verdict copy · zero-open path → passes when: integration test on seed data queues the right mix; night-simulation returns next-opening times; cache-copy test green.
- [ ] **3.2 dispatch** 🤖 — single claim function inside `pg_advisory_xact_lock`: all caps + 1-hour rule + open-now + search-active + fairness + bench promotion; ElevenLabs POST; dial_log lifecycle → passes when: **`dispatch.stress`**: 20 concurrent invocations on contrived data never exceed 3/search or 8 global, never dial one number twice within an hour; a definite ElevenLabs rejection frees the number, an ambiguous timeout does not.
- [ ] **3.3 record_call_event (full)** 🤖 — dedupe by event key · legal transitions only · `waitUntil()` handoffs → passes when: `webhook.idempotent` (same payload twice = one effect); a failure webhook flips the row to `unreached` AND promotes a bench row.
- [ ] **3.4 extract_result** 🤖 + 🧑 — gpt-5.4-mini, strict schema, 2 retries → escalate → `extraction_failed`; verdict fan-out; rank keys → passes when: 🤖 replay of ≥5 stored transcripts yields valid JSON; 🧑 Marvin reads 5 transcript→verdict pairs and agrees every one.
- [ ] **3.5 ONE SLICE END-TO-END** 🧑 — one DEV_TEST search, ONE fake pharmacy, teammate role-plays "in stock, 2 boxes" with a 60s shelf-check silence → passes when: 🧑 verdict appears on the live board ~4 min after clicking Search with zero manual pokes, correct amount, correct timestamp.
- [ ] **3.6 Widen to the full search** 🧑 — 3 lines, 6 targets, fake bench: teammates run the whole role-play table (happy path, orderable, plain no, wrong branch, voicemail, are-you-a-robot) → passes when: 🧑 every scenario lands in its intended bucket in ONE dress search; 🤖 all rows terminal after settle, zero zombies (`select status, count(*)` shows only terminal states).

---

## Phase 4 — Hardening: the second risk zone (~1.5h)

- [ ] **4.1 settle + expiry** 🤖 — drain/20-min settle; children → `expired`; claim gates on active search → passes when: simulated-timeout test expires queued children; a late webhook records data but never triggers a dial.
- [ ] **4.2 Watchdog (pg_cron)** 🤖 — 3 rules: stale in-flight → reconcile via `GET /conversations/{id}`; stuck `transcript_ready` → re-extract; dead-quiet search → settle. Anomaly log on every action → passes when: `watchdog.reconcile`: a deliberately-dropped webhook is rescued < 90s; a stuck transcript re-extracts; actions logged.
- [ ] **4.3 Anonymous auth + RLS** 🤖 + 🧑 — `signInAnonymously`, `owner` scoping, transcripts excluded from client grants → passes when: 🤖 `rls.two-sessions`: session B cannot select/subscribe to session A's rows; 🧑 quick two-browser check confirms.
- [ ] **4.4 Abuse guards** 🤖 — 1 active search per session/IP · `INTERNAL_SECRET` on internal routes · `DIALING_ENABLED` kill switch inside the claim path → passes when: scripted 2nd search → rejected; internal route w/o secret → 401; switch OFF → dispatch claims nothing.
- [ ] **4.5 DEV_TEST → REAL flip** 🤖 — flip cancels all non-terminal rows; REAL + verified-only enforced in the claim → passes when: `flip.cancels` green on staged data.

---

## Phase 5 — Real mode + deliverables (tomorrow morning)

- [ ] **5.1 Demo-area pharmacy seed** 🧑 — B5 list loaded; teammates spot-call; `verified` flags set → passes when: 🧑 ≥8 verified pharmacies with confirmed opening hours for TODAY (incl. any holiday overrides).
- [ ] **5.2 REAL verification search (~09:00)** 🧑 — one real search, everyone watching → passes when: 🧑 ≥1 genuine verdict from a real pharmacy; logs archived to `/evidence`.
- [ ] **5.3 The video run (~10:20)** 🧑 — fresh search on the 65-min-rested pharmacy set; record per the 60-second shot list → passes when: 🧑 video shows a live call + the board updating, ≤ 60 seconds, uploaded.
- [ ] **5.4 README + repo + submit** 🤖 + 🧑 — README (problem → diagrams → sponsor table → AI-usage note), `docs/` + `docs/review/` + `evidence/` populated, final push → passes when: 🤖 fresh clone builds; 🧑 Marvin approves the README and clicks submit before 11:45.
