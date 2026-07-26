# Relay — Build Steps (living state file)

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

- [x] **0.1 Repo scaffold** 🤖
  - [x] 0.1.1 Next.js (App Router, TS) scaffold matching the approved tree → passes when: `npm run build` green, folder tree matches the approved structure. ✅ build + typecheck green.
  - [x] 0.1.2 git init + first commit + `.env.example` naming every key → passes when: `git log` shows commit; `.env.local` is ignored (`git status` clean with it present). ✅ commit 048dd05; env ignored verified.
  - **Step success:** fresh `npm install && npm run build` green from a clean checkout. ✅

- [x] **0.2 Database schema v1** 🤖
  - [x] 0.2.1 Migrations: `medications, pharmacies, searches, calls, call_events, dial_log` (+ `anomalies`) with status enums, `unique(search_id, pharmacy_ods)`, CHECK constraints (no stock verdict without confirmed branch) → passes when: migration applies cleanly to a fresh database. ✅ `supabase db reset` clean on the local stack (ports moved to 555xx; analytics container off for colima).
  - [x] 0.2.2 Constraint proof script: attempts forbidden inserts (bucket-1 without `location_confirmed`, duplicate pharmacy per search, etc.) → passes when: all are REJECTED by the database itself. ✅ Originally 6 states (commit 2c2467b); criterion extended to **13** during 0.2b/0.5 review fixes — current gate: `scripts/prove-constraints.sql` ends "ALL 13 FORBIDDEN STATES REJECTED". 13/13 green.
  - **Step success:** schema up + all forbidden-state inserts bounce. ✅

- [x] **0.3 Deployed shell** 🤖 + 🧑 — https://medfind-three.vercel.app · codex phase-0 review: 9 findings, all fixed in 0.2b (verdict-leak bypasses, dial_log lifecycle, append-only triggers, E.164, explicit grants, ON_ERROR_STOP, seed glob, attempts 0–3, engines).
  - [x] 0.3.1 Vercel project + env vars + deploy → passes when: 🤖 prod URL returns 200. ✅ https://medfind-three.vercel.app (project `medfind`, 8 prod env vars set).
  - [x] 0.3.2 Placeholder page reads a count from the DB → passes when: 🧑 Marvin opens the URL and sees "Relay — N pharmacies loaded." ✅ Marvin: "Checked, its correct."
  - **Step success:** the deployed site provably talks to the database.

- [x] **0.4 TRACER BULLET — one real call, no logic** 🧑 *(the whole point of Phase 0)*
  - [x] 0.4.1 Import Twilio number into ElevenLabs (SID + auth token) → passes when: 🧑 number shows "imported" in the ElevenLabs dashboard. ✅ Marvin confirmed; +442046522842 (twilio) visible via API.
  - [x] 0.4.2 Minimal agent (temporary config, not the full script) + dashboard test call → passes when: 🧑 Marvin's phone rings from the dashboard and he hears the voice. ✅ Marvin: "tested and the agent talks to me and it works."
  - [x] 0.4.3 Outbound call via API from a script, `call_ref` in dynamic variables → passes when: 🤖 response contains `conversation_id` + `callSid`. ✅ conv_7901kye0…, CA592f9f….
  - [x] 0.4.4 Webhook route: HMAC verify → append raw to `call_events` → 200 → passes when: 🤖 a forged-signature POST gets 200 + log + NO row ✅ (vs prod); a real webhook writes a row ✅ (event id 1).
  - [x] 0.4.5 End-to-end tracer: script dials Marvin, he answers, hangs up → passes when: 🤖 within 60s `call_events` holds a `post_call_transcription` row whose `call_ref` matches, with real transcript text ✅ (landed ~45s). 🧑 Marvin confirmed the transcript. ✅ "Approved."
  - **Step success:** the scary seam works end-to-end, correlated by OUR id, before any product logic exists. ✅ **PHASE 0 CLOSED.**

- [x] **0.5 End-of-phase review fixes** 🤖 *(added after codex end-of-phase review — criterion recorded here per protocol)* — 5 findings (1×P1 always-200 escape path, 4×P2: raw_body evidence, body cap, revoke-then-grant, delete guard) → passes when: all fixed, proof extended, attack-verified against prod. ✅ commit a32c228; forged/garbage/2MB-body POSTs all return 200 with nothing persisted; proof 13/13; reports in `docs/review/`. Gate before Phase 1/2 satisfied.

---

## Phase 1 — Product UI: fold in the teammate's `relay` repo (restructured 26 Jul ~03:15)

*Teammate delivered the UI as a **standalone repo** (`~/Downloads/relay`, branded **"Relay"**, Next 14/React 18/Tailwind 3) — a landing page (`/`) + a simulated `/search` experience behind a clean `SearchEngine` seam ("swap the engine, UI unchanged"). Original Phase 1 assumed in-repo UI work, so it's restructured: the fold-in is now explicit step 1.2, old 1.2/1.3/1.4 become 1.3/1.4/1.5 (runbook §UI contract ref updated). **Protocol deviation, stated:** the 🧑 steps 1.3–1.5 park at `[?]` in sequence without waiting for each other's approval — their build halves are one atomic port and Marvin is asleep-adjacent; approvals stay individually gated.*

- [x] **1.1 Fake data seed** 🤖 ✅ `scripts/seed-fake-board.sql` — idempotent (upserts; delete guard forbids wipes), 10 rows/7 statuses/buckets 1–4, proof 13/13 on seeded DB, commit 7bb4ad2. — script inserts fake 24/7 pharmacies + 1 fake search + **10** call rows covering every UI state (queued · dialing · transcript_ready · in-stock · in-stock-partial · orderable · no-stock · unreached · wrong_location · expired) and buckets 1–4 *(criterion updated from "8 rows": expired, partial-stock and transcript_ready rows added so the board can show everything)* → passes when: seed applies clean on the local stack after `db reset` + prove-constraints still 13/13; rows visible in Supabase Studio.
- [x] **1.2 Relay fold-in (mechanical port + review fixes)** 🤖 ✅ typecheck + 9/9 tests + build green · db reset + seed + 13/13 proof green · both routes browser-verified (demo banner, validation error, ≤3 concurrency, no ConnectFlow, geocode proxy on real B5 4BU map) — see commit + `docs/review/2026-07-26-ui-merge-review.md`. — vendor landing + `/search` + tokens/fonts/globals into this repo, ported to Next 16 / React 19 (react-leaflet@5; unused Google-Maps variant + dep dropped; teammate `.env.local` NOT copied); waitlist table as a migration; footer disclaimer extended to the required 999/111 text. *(Criterion extended mid-step: a codex gpt-5.6-sol adversarial review of the merge — `docs/review/2026-07-26-ui-merge-review.md`, 4×P1/11×P2/5×P3 — gated this step on its fix-pack: demo-mode disclosure + ConnectFlow parked (P1-1) · analytics allowlist, no autocapture (P1-2) · geocoding proxied server-side (P1-3) · postcode validation + HTML escaping (P1-4) · explicit geocode-failure state (P2-1) · in-flow safety line (P2-2) · sim + landing animation retimed to the ≤3 cap (P2-3) · waitlist success only after a real store (P2-4) · email CHECK constraint (P2-5) · synthetic baseline-214 removed (P2-6) · SMS/"live" copy honesty (P2-7/P2-10) · combobox aria-labelledby (P2-8) · stale-dose clear (P2-9) · 3 real test files replace passWithNoTests (P2-11) · .gitignore precedence, revoke-PUBLIC on waitlist_count, DemoCallPhase rename + dead export removed (P3-1/3/4).)* → passes when: `typecheck` + `test` + `build` green; local `db reset` + seed + 13/13 proof green; `/` and `/search` render; simulated demo plays end-to-end with the demo banner visible.
- [x] **1.3 Search form** 🧑 *(was 1.2)* ✅ machine-green + Marvin: "Approved" (26 Jul ~04:45). — med combobox (shortage-flagged list) · dose · **quantity 1–20 (added — partial-stock display needs it)** · postcode; disclaimer visible; submits through the `SearchEngine` seam *(criterion clarified: the stub `create_search` behind that seam physically lands with the live engine in 1.5; radius + NHS/private dropped per teammate's shipped design — radius defaults server-side)* → passes when: 🧑 Marvin + teammate approve on phone AND desktop.
- [x] **1.4 Scoreboard states** 🧑 *(was 1.3)* ✅ machine-green (mapper 18/18, all states browser-verified) + Marvin: "Approve" (26 Jul ~04:45). — every state visually distinct (queued · calling · checking stock · in stock · can order · no stock · couldn't reach · couldn't verify branch · not checked in time), timestamps ("confirmed by phone at 14:32"), partial-quantity display ("1 box — you need 2"); pure DB-row→UI mapper (`lib/domain/call-presentation.ts`, unit-tested on the 10 seed-state shapes) *(criterion clarified: the visual gate demos on the extended simulated script covering the same states; rendering the actual seeded DB rows is proven by 1.5's live engine, which uses this mapper)* → passes when: 🤖 mapper tests green on all seed shapes; 🧑 bucket 4 is unmistakably NOT a stock verdict; disclaimer present; teammate + Marvin sign off.
- [x] **1.5 Realtime proof** 🤖 + 🧑 *(was 1.4)* ✅ 🤖 `scripts/test-realtime.mjs` vs cloud 5/5 (tick 292ms; transcript select DENIED; stranger silent) + browser SQL-update re-sort < 2s · 🧑 Marvin watched the kicker-driven prod board: "approve" (26 Jul ~04:55). *Notes for later steps: `persistSession:false` → new anon user per reload (4.3/4.4 own session persistence + guards); structural split of private calls columns into a service-only table = post-hackathon refactor.* **PHASE 1 CLOSED.** — anonymous sign-in; stub `create_search` command writes fixture rows per-caller; `/search?engine=live` selects the live engine; **board-tick design** *(criterion updated after probe-verified finding: realtime refuses column-granted tables, and table-granting `calls` would leak transcript/dial-number columns — so a trigger bumps the OWN `searches` row on every calls change and the client refetches column-granted calls per tick; runbook §UI contract updated to match)*; manually UPDATE a calls row in SQL → passes when: 🤖 `scripts/test-realtime.mjs` shows the tick land < 2s + refetch carries no transcript field + a stranger session hears nothing; 🧑 Marvin watches the board update < 2s with no refresh.

**UI-merge decisions — Marvin ruled 26 Jul ~04:00:**

| # | Decision | Status |
|---|---|---|
| F1 | Product name is **Relay** | ✅ Repo-wide rebrand (living docs + package name; historical docs/review + evidence untouched; Vercel URL stays medfind-three.vercel.app unless Marvin renames the project) |
| F2 | Real waitlist count only (no +214) | ✅ Marvin agreed — waitlist section retires in the morning anyway |
| F3 | ConnectFlow | ✅ Parked (component kept, never rendered) |
| F4 | Map third parties | ✅ Swapped to a **keyless first-party schematic map** — Leaflet/OSM/tile requests removed entirely; `/api/geocode` proxy stays for the 1.5 live engine (server-side postcodes.io was already the 3.1 plan). PostHog stays key-less/disabled with allowlist |
| F5 | Radius + NHS/private dropped from form (teammate's design) | Open — default stands (server-side radius default in 3.1) |
| F6 | Teammate's Supabase holds early signups | Moot once waitlist retires; nothing to do |
| F7 | Google map dropped; Netlify fallback kept (now honest per P2-4) | ✅ OK'd |

**Deferred by Marvin:** codex P2-5 (waitlist abuse guards → folds into step 4.4) · P3-5 (stats/testimonial provenance links → optional polish).

---

## Phase 2 — Pure logic, headless, test-driven (parallel with Phase 1) (~1.5h)

*Test pyramid base: the rules live here, no network, no UI. All 🤖.*

- [x] **2.1 Opening-hours module** 🤖 ✅ `lib/domain/opening-hours.ts`, 12/12 incl. `hours.bst-boundary` both directions (July 17:30 UTC = 18:30 London → closed; January → open but fails the 1h stay-open rule), lunch gap, 24:00-rollover for 24/7, junk-hours-never-dial, weekly-minutes size proxy + nextOpening for the zero-open path.
- [x] **2.2 Portfolio scorer** 🤖 ✅ `lib/domain/portfolio.ts`, 9/9: ≤2/chain (independents uncapped), ≥2 independents + ≥1 supermarket when available (swaps respect the chain cap AND each other), closed/closing-soon thrown out, weights 0.35/0.25/0.25/0.15, deterministic under input shuffle, ranked bench.
- [x] **2.3 Verdict schema + buckets** 🤖 ✅ `lib/domain/verdict.ts`: zod ExtractionSchema = §5 verbatim with schema teeth; mapper → dbStatus/bucket/verdict-jsonb + quantity + eta_days normalizers; `bucket.wrong-location` green (wrong OR unconfirmed branch → bucket 4, no payload) + fixed a latent Phase-1 bug found via §5: a verdict-status row with bucket 4 (refused/unclear) rendered as "No stock" — presentCall now maps it to unverified (regression-tested).
- [~] **2.4 Dial resolution** 🤖 — `resolveDialNumber()` DEV_TEST/REAL + per-claim snapshot fields → passes when: both modes unit-tested; REAL refuses unverified pharmacies.

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
