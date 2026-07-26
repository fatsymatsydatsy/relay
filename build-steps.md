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
| Extraction dead-end (wrong branch/voicemail/refused) never pulls a bench replacement | `bench.extraction-deadend` (3.6 dress finding) |
| DEV_TEST pharmacies poison a REAL search's targets/cache | `mode.isolation` (3.7 audit P1-1) |
| Claim dials a pharmacy closing within the hour / junk hours | `claim.stay-open` (3.7 audit P1-2) |
| Misconfigured cap >8 dials beyond the global ceiling | `caps.clamped` (3.7 audit P1-6) |
| Extraction EXHAUSTION (not just parsed dead ends) strands the bench | `bench.exhaustion-promotes` (3.7 audit P1-3) |
| Lost `after()` + duplicate webhook = call stuck dialing forever | `webhook.duplicate-interprets` (3.7 audit P1-7) |
| Verbatim pharmacist quotes reach the browser | `verdict.no-verbatim` (3.7 audit P1-4) |
| Quantity parser fabricates amounts ("few"→3, strength digits) | `quantity.conservative` (3.7 audit P2-2) |
| Same-chain supermarket swap wrongly rejected | `portfolio.supermarket-swap` (3.7 audit P2-4) |

---

## Phase 0 — Walking skeleton + the scariest seam, alone (~2h)

*Per how-we-work §2: prove the architecture end-to-end with zero domain logic before building on it. Our scariest seam is Vercel↔ElevenLabs↔Twilio↔Supabase — it gets a tracer bullet FIRST.*

- [x] **0.1 Repo scaffold** 🤖
  - [x] 0.1.1 Next.js (App Router, TS) scaffold matching the approved tree → passes when: `npm run build` green, folder tree matches the approved structure. ✅ build + typecheck green.
  - [x] 0.1.2 git init + first commit + `.env.example` naming every key → passes when: `git log` shows commit; `.env.local` is ignored (`git status` clean with it present). ✅ commit 048dd05; env ignored verified.
  - **Step success:** fresh `npm install && npm run build` green from a clean checkout. ✅

- [x] **0.2 Database schema v1** 🤖
  - [x] 0.2.1 Migrations: `medications, pharmacies, searches, calls, call_events, dial_log` (+ `anomalies`) with status enums, `unique(search_id, pharmacy_ods)`, CHECK constraints (no stock verdict without confirmed branch) → passes when: migration applies cleanly to a fresh database. ✅ `supabase db reset` clean on the local stack (ports moved to 555xx; analytics container off for colima).
  - [x] 0.2.2 Constraint proof script: attempts forbidden inserts (bucket-1 without `location_confirmed`, duplicate pharmacy per search, etc.) → passes when: all are REJECTED by the database itself. ✅ Originally 6 states (commit 2c2467b); criterion extended to **13** during 0.2b/0.5 review fixes, then to **17** in 3.7 (bucket/payload matrix, audit P2-3) — current gate: `scripts/prove-constraints.sql` ends "ALL 17 FORBIDDEN STATES REJECTED".
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
- [x] **2.4 Dial resolution** 🤖 ✅ `lib/domain/dial-resolution.ts`: DEV_TEST deterministic team-phone spread (intended vs resolved snapshot preserved); REAL refuses unverified AND dev_test-sourced pharmacies; E.164 enforced both sides. 7/7 tests. **PHASE 2 CLOSED** — 66/66 total, typecheck + build green.

---

## Phase 3 — The vertical slice, then widen (~3h, my core block)

- [x] **3.1 create_search** 🤖 ✅ real command in `lib/commands/create_search.ts` (stub renamed → `demo_search.ts`, still behind the demo route until 3.5); server geocode extracted to `lib/integrations/geocode.ts`; integration test on the LOCAL stack 3/3: queue mix (6 targets, ≤2/chain, supermarket in, closing-soon excluded entirely), cache-copy with ORIGINAL verdict_at + copied_from_call_id, night zero-open → complete + next openings. Suite 69/69.
- [x] **3.2 dispatch** 🤖 — single claim function inside `pg_advisory_xact_lock`: all caps + 1-hour rule + open-now + search-active + fairness + bench promotion; ElevenLabs POST; dial_log lifecycle → passes when: **`dispatch.stress`**: 20 concurrent invocations on contrived data never exceed 3/search or 8 global, never dial one number twice within an hour; a definite ElevenLabs rejection frees the number, an ambiguous timeout does not. ✅ *(History: commit c5d918b built the serialized core and dispatch.stress went green, but the step was left `[~]` — the 3.7 audit ruled that honest: hard cap ceilings, the stay-open horizon, and atomic bench promotion were missing. 3.7.2/3.7.3 closed them; closed [x] 26 Jul ~07:05 with dispatch.stress + claim-hardening green. Known refinement, accepted: candidate ORDER BY fairness is per-invocation, not re-sorted between claims in one pass.)*
- [x] **3.3 record_call_event (full)** 🤖 ✅ `lib/commands/record_call_event.ts` behind the hardened 0.4 route (interpretation post-200 via next/server `after()`; dedupe layer 1 = dedupe_key unique, layer 2 = `UPDATE … WHERE status='dialing'`): `webhook.idempotent` green (same payload twice = one transition, one extract, one dispatch) · failure → `unreached` b4 + bench promotion · orphans → anomaly log · drain-settle expires leftover bench + completes the search. 76/76.
- [x] **3.4 extract_result** 🤖 + 🧑 ✅ — gpt-5.4-mini, strict schema, retries → gpt-5.6-sol → honest `extraction_failed`; verdict fan-out; scripted-replay integration 5 shapes + real-LLM extractions verified live in 3.5 + 3.6 (12 real calls total, every verdict matched the role-play). 🧑 covered by Marvin's Phase-3 approval; per-pair readout anytime via `scripts/replay-transcripts.mjs`.
- [x] **3.5 ONE SLICE END-TO-END** 🧑 ✅ ran 04:31–04:34 (3m18s click→settled, zero pokes): 6 dials over 3 waves (≤3 in flight held), Marvin's role-play landed **b1 in-stock ×2** with timestamp; 4 bench rows expired at drain-settle. Marvin: "Looks good" + full log verification (DB ↔ dial_log ↔ webhooks ↔ ElevenLabs all agree; evidence/2026-07-26-slice-3.5.md). Finding: 119s unreached call = voicemail sat through → Marvin to enable dashboard voicemail-detection toggle.
- [x] **3.6 Widen to the full search** 🧑 ✅ dress ran 04:51–04:52 (Cambridge set, 1m36s click→settled): 6 dials over 3 lines / 2 per team phone, 5 human pickups + 1 decline that voicemail-detection killed in **2s** (vs 119s pre-fix); scenarios landed b1×2-boxes · b2-Thursday · b3 · wrong-branch b4 ×2 · unclear b4; 🤖 zero zombies (`{verdict:4, wrong_location:2, expired:4}`), search self-settled. Marvin: "Yep looks good" + log verification (evidence/2026-07-26-dress-3.6.md). **Dress finding → fixed + deployed:** extraction dead-ends now promote the bench (`bench.extraction-deadend`, 81/81). **PHASE 3 CLOSED.**

- [x] **3.7 Phase 2–3 audit fix-pack** 🤖 *(from the codex gpt-5.6-sol xhigh audit, `docs/review/2026-07-26-phase-2-3-audit-codex.md` — criteria recorded before build per protocol. Scoping: P1-5 full deadline/settle machinery stays 4.1 (a claim-side 20-min age gate + attempt ceiling land HERE) · P1-7 durable outbox/watchdog stays 4.2 (duplicate-delivery re-interpretation lands HERE) · P2-5 DST-instant math and P2-2 canonical med SKU deferred post-hackathon, stated risk accepted (spring-forward is Mar 2027; med list is curated with form in the display name).* **✅ commit 7496c11: typecheck + 99/99 (18 new tests) + build green; db reset + 17/17 proof green. Deployed 26 Jul ~07:15 (Marvin ran `supabase db push` + `vercel deploy --prod` — sandbox blocks prod-DB writes from the agent). Post-deploy verification `scripts/verify-deploy.mjs` 10/10 vs prod: dial_mode live (legacy=DEV_TEST) · extraction service-only (anon 42501) · verdict grant intact · both RPCs live + anon-denied · site 200 · live demo smoke landed dial_mode=DEMO. Cloud census: 20 pharmacies, ALL dev_test, 0 verified — the audit's P1-1 premise confirmed; REAL-eligible pool is empty until 5.1 seeds verified B5 rows.**
  - [x] 3.7.1 **Mode isolation (P1-1)**: `searches.dial_mode` (DEV_TEST/REAL/DEMO; legacy rows backfilled DEV_TEST); `create_search` filters the candidate pool by mode (REAL → verified, non-dev_test only) and scopes the verdict cache + fan-out to same-mode searches; demo searches (command AND seed) write DEMO, are never claimable, and their rows don't count toward the global cap; claim adds `s.dial_mode = p_dial_mode` → passes when: `mode.isolation` int tests — a REAL search over mixed pharmacies targets ONLY verified real ones; a newer cross-mode verdict is skipped for the same-mode one; a DEMO dialing row doesn't eat cap and a DEMO queued row is never claimed. ✅ 4+1 tests green.
  - [x] 3.7.2 **Claim-side politeness hardening (P1-2 + P1-5 + P1-6)**: fail-closed SQL hours validation + 60-min stay-open check (`pharmacy_dialable`) inside the locked claim; caps clamped BOTH layers (TS `clampCap`, SQL `least(cap,8)`/`least(cap,3)`); per-search 12-attempt ceiling counting reserved/connected dial_log rows; claims refused once the search is >20 min old → passes when: `claim.stay-open` (closing-in-30 + junk-hours never claimed, control claimed) + `caps.clamped` (cap=20 still claims exactly 8) + attempt-ceiling + age-gate tests green. ✅
  - [x] 3.7.3 **Atomic bench promotion + settle (P1-3)**: `promote_bench` / `settle_if_drained` are advisory-locked SQL RPCs (single-row `FOR UPDATE SKIP LOCKED` promotion) on the SAME lock as the claim, used by record_call_event, dispatch-failure, and extract_result paths; extraction EXHAUSTION now promotes too → passes when: `bench.exhaustion-promotes` green (bench steps up + refill dispatched + search stays active); existing promotion/settle suites stay green through the RPC swap. ✅
  - [x] 3.7.4 **Webhook duplicate re-interpretation (P1-7 minimal)**: scheduling policy extracted (`lib/domain/webhook-policy.ts`) — a duplicate raw insert (23505) still schedules idempotent interpretation, so a provider redelivery heals a lost `after()`; other insert errors stay uninterpreted (store-raw-first) → passes when: `webhook.duplicate-interprets` policy tests green + `webhook.idempotent` proves re-interpretation is one transition. ✅
  - [x] 3.7.5 **Client payload hygiene (P1-4 + P2-2 parser)**: verdict jsonb allowlisted to structured fields only — notable quotes and verbatims never reach client-granted columns; full extraction stored in service-only `calls.extraction` (not in the column grant; re-runnable); synthetic `eta_label` replaces quoted eta; `parseQuantity` unit-anchored + conservative (no `few→3`, never strength digits like "the 25,000") → passes when: `verdict.no-verbatim` + `quantity.conservative` + eta_label tests green; presentation mapper green on the new shape. ✅
  - [x] 3.7.6 **DB bucket/payload matrix (P2-3)**: CHECK matrix — bucket 1↔in_stock, 2↔orderable, 3↔out_of_stock, 4/null↔no stock claim (`is not distinct from` so NULL results can't slip; `NOT VALID` tolerates legacy cloud rows, enforced for all new writes) → passes when: proof script rejects every mismatch. ✅ 17/17.
  - [x] 3.7.7 **Portfolio + eventless stalls (P2-4 + P2-1)**: same-chain supermarket swap satisfies the quota when legal; `create_search` immediately settles an all-cached search (bench expired, search complete, board tick fires); a definite-rejection wave triggers ONE bounded re-claim pass (never a hot loop) → passes when: `portfolio.supermarket-swap` + all-cached-settles + rejection-repass tests green. ✅
  - **Step success:** typecheck + full suite + build green ✅ · local `db reset` + 17-state proof green ✅ · migration pushed to cloud + prod redeployed (🧑 Marvin — sandbox-blocked) · cloud REAL-mode pool provably excludes dev_test pharmacies (SQL check against prod, after push).

---

## Phase 4 — Hardening: the second risk zone (~1.5h)

- [ ] **4.1 settle + expiry** 🤖 — drain/20-min settle; children → `expired`; claim gates on active search → passes when: simulated-timeout test expires queued children; a late webhook records data but never triggers a dial.
- [ ] **4.2 Watchdog (pg_cron)** 🤖 — 3 rules: stale in-flight → reconcile via `GET /conversations/{id}`; stuck `transcript_ready` → re-extract; dead-quiet search → settle. Anomaly log on every action → passes when: `watchdog.reconcile`: a deliberately-dropped webhook is rescued < 90s; a stuck transcript re-extracts; actions logged.
- [ ] **4.3 Anonymous auth + RLS** 🤖 + 🧑 — `signInAnonymously`, `owner` scoping, transcripts excluded from client grants → passes when: 🤖 `rls.two-sessions`: session B cannot select/subscribe to session A's rows; 🧑 quick two-browser check confirms.
- [ ] **4.4 Abuse guards** 🤖 — 1 active search per session/IP · `INTERNAL_SECRET` on internal routes · `DIALING_ENABLED` kill switch inside the claim path → passes when: scripted 2nd search → rejected; internal route w/o secret → 401; switch OFF → dispatch claims nothing.
- [ ] **4.5 DEV_TEST → REAL flip** 🤖 — flip cancels all non-terminal rows; REAL + verified-only enforced in the claim → passes when: `flip.cancels` green on staged data.

---

## Phase 5 — Real mode + deliverables (tomorrow morning)

- [?] **5.0 NHS pharmacy ingestion** 🤖 + 🧑 *(added 26 Jul ~07:20 per Marvin: "I want the real NHS API." Fills the gap found post-3.7: the architecture's `seed_pharmacies` command was never built and prod has 0 verified pharmacies. Design: NHS Service Search API (api.nhs.uk, subscription key — Marvin registers; agent cannot create accounts) → fail-closed normalization → upsert `source='nhs_api'`, `verified=false`; the 08:30 spot-call still flips `verified` (API data is never trusted as dial-truth). NOTE: today is SUNDAY (runbook header said Sat) — seeding must surface Sunday hours.)*
  - [x] 5.0.1 **Normalizer (pure domain)** 🤖 ✅ `lib/domain/nhs.ts`, 16/16 (`tests/nhs.test.ts`): General-only weekly rows (Additional/date-specific ignored); `IsOpen=false` closes the day; lunch gaps kept; offsets preferred over HH:MM strings; `00:00` close → `24:00`; midnight-crossing split across days (stay-open rule sees the continuation); JSON-encoded-string wire variant accepted; junk → null (never dial); phones → E.164 with refuse-to-guess; chain/supermarket inference (Wellington ≠ Well).
  - [x] 5.0.2 **API client + seeder** 🤖 ✅ `lib/integrations/nhs.ts` (DoHS v3, `apikey` header, `OrganisationTypeId eq 'PHA' and OrganisationSubType eq 'Community'` + `geo.distance` filter/order — contract from OAS 474338 + live sandbox probe; NOTE: old v1/v2 Service Search retired 2 Feb 2026) + `scripts/seed-nhs-pharmacies.ts` (`npm run seed:nhs`). Machine-green: typecheck + 115/115 + build; fixture dry-run on LOCAL correct (3 normalized incl. Sunday hours + dialable-now column, DSP dropped); write path proven: insert `verified=false` → `--verify X99001` → re-seed = 3 updated with **verified preserved**; live keyless SANDBOX pull parsed real wire data (canned dentists all dropped fail-closed). Fallback shipped: `--from-file` + `tests/fixtures/nhs-organisations-sample.json` (drama-range phones, dial-dead by design).
  - [?] 5.0.3 **Live fetch** 🧑 — Marvin: NHS Digital Onboarding Service developer account → application on the **Integration test** env (self-service; prod needs approval — post-hackathon) → subscribe to "Directory of Healthcare Services API" → key into `.env.local` as `NHS_DOHS_API_KEY` → `npm run seed:nhs -- --postcode "B5 4BU" --env int` → passes when: 🧑 ≥8 real B5 pharmacies with plausible SUNDAY hours land in prod, one spot-checked against nhs.uk. (No key in time → `--from-file` keeps 5.1 alive.)
- [ ] **5.1 Demo-area pharmacy seed** 🧑 — B5 list loaded **via 5.0**; teammates spot-call; `verified` flags set (`scripts/seed-nhs-pharmacies.ts --verify …`) → passes when: 🧑 ≥8 verified pharmacies with confirmed opening hours for TODAY — **Sunday** — (incl. any holiday overrides).
- [ ] **5.2 REAL verification search (~09:00)** 🧑 — one real search, everyone watching → passes when: 🧑 ≥1 genuine verdict from a real pharmacy; logs archived to `/evidence`.
- [ ] **5.3 The video run (~10:20)** 🧑 — fresh search on the 65-min-rested pharmacy set; record per the 60-second shot list → passes when: 🧑 video shows a live call + the board updating, ≤ 60 seconds, uploaded.
- [ ] **5.4 README + repo + submit** 🤖 + 🧑 — README (problem → diagrams → sponsor table → AI-usage note), `docs/` + `docs/review/` + `evidence/` populated, final push → passes when: 🤖 fresh clone builds; 🧑 Marvin approves the README and clicks submit before 11:45.
