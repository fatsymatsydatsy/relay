<!-- Provenance: codex CLI v0.145.0 · model gpt-5.6-sol · reasoning effort xhigh · sandbox read-only · run 26 Jul 2026 ~08:20-08:55 BST against clean tree at c5d5969 (91 investigative commands). Machine checks (typecheck, 137/137 vitest incl. integration vs local stack, build, db reset + 17-state proof) run by Claude immediately before launch and supplied as given. The internal two-axis review findings + c5d5969 fix-pack were disclosed to the auditor with instructions to verify each fix adversarially. Claude spot-verified P1-2 (supabase-browser.ts persistSession:false + per-start client), P2-3 (transcript object carries analysis into the prompt) and the P1-1 demo-fixture timings after delivery. -->

# Relay Phase 4 — Adversarial Hardening Audit

**Date:** 26 July 2026  
**Scope:** Phase 4 and the 3.7 response surface  
**Commit range:** `1145aad..c5d5969`  
**Method:** Read-only inspection of the full diff, current implementations, migrations, routes, scripts, state-machine documentation, predecessor audit, and every named test. I traced competing webhook/watchdog/claim/flip transactions and compared the original Phase 4 criteria at `1145aad` with their final wording. No network, cloud, provider, or filesystem mutation was performed. The supplied green machine results were accepted as given; this audit evaluates what they prove.

## TL;DR verdict

**No: Phase 4 is not sound for an unrestricted REAL-mode run or for relying on the server-backed DEMO board today.**

The underlying claim RPC, REAL pharmacy eligibility rules, RLS grants, internal-secret guard, and expected-status webhook idempotency are strong. The blockers are shared assumptions outside those mechanisms:

- The watchdog processes DEMO rows and will progressively corrupt a fresh demo board.
- The browser creates a disposable anonymous owner on every search start, defeating the one-active-search index and permitting many REAL searches from one browser.
- Watchdog terminal updates, bench promotion, and settlement are separate transactions. A concurrent settlement can complete a search before its replacement is promoted.
- The watchdog cannot guarantee the claimed `<90s` rescue and can exceed both the 55-second cron request timeout and 60-second route duration.
- A single provider `404`, or mere age when no conversation ID exists, is treated as definite despite the stated fail-safe rule.
- Unknown provider statuses can remain `in_progress` forever, pinning all eight global slots and freezing boards.

For today, REAL should remain gated to a single trusted operator until at least the session/abuse bypass and ambiguous watchdog transitions are fixed. The flip should be performed with dialing disabled and dispatch quiesced. The server-backed DEMO board should not be used with the current watchdog running.

## Findings

| ID | Severity | Summary | Primary evidence |
|---|---|---|---|
| P1-1 | P1 | The watchdog is not DEMO-scoped and mutates the video fallback board | [watchdog.ts:112](/Users/marvin/hackathon/lib/commands/watchdog.ts:112) |
| P1-2 | P1 | Disposable anonymous sessions bypass the one-active-search abuse guard | [supabase-browser.ts:13](/Users/marvin/hackathon/lib/integrations/supabase-browser.ts:13) |
| P1-3 | P1 | Terminal transition, bench promotion, and settlement are not atomic together | [record_call_event.ts:125](/Users/marvin/hackathon/lib/commands/record_call_event.ts:125) |
| P1-4 | P1 | The watchdog can overrun its execution envelope and does not prove `<90s` rescue | [watchdog.ts:119](/Users/marvin/hackathon/lib/commands/watchdog.ts:119) |
| P1-5 | P1 | Ambiguous provider evidence is converted into a terminal failure and replacement dial | [watchdog.ts:120](/Users/marvin/hackathon/lib/commands/watchdog.ts:120) |
| P1-6 | P1 | Unknown or permanently processing provider states can freeze searches indefinitely | [elevenlabs.ts:51](/Users/marvin/hackathon/lib/integrations/elevenlabs.ts:51) |
| P2-1 | P2 | The flip lock is not an end-to-end dial barrier, and one c5 migration writes outside it | [dispatch.ts:79](/Users/marvin/hackathon/lib/commands/dispatch.ts:79) |
| P2-2 | P2 | Bucket-4 rows retain a client-readable structured verdict payload | [verdict.ts:143](/Users/marvin/hackathon/lib/domain/verdict.ts:143) |
| P2-3 | P2 | Provider-generated `analysis` is fed to the verdict extractor despite “transcript is truth” | [record_call_event.ts:100](/Users/marvin/hackathon/lib/commands/record_call_event.ts:100) |
| P3-1 | P3 | Watchdog-synthesized events bypass the append-only raw-event ledger | [watchdog.ts:167](/Users/marvin/hackathon/lib/commands/watchdog.ts:167) |
| P3-2 | P3 | Watchdog cron setup has fragile secret interpolation and no failure alerting | [setup-watchdog.sql:5](/Users/marvin/hackathon/scripts/setup-watchdog.sql:5) |
| P3-3 | P3 | Several named tests prove only sequential mocked behavior, not their stated criteria | [watchdog.int.test.ts:82](/Users/marvin/hackathon/tests/watchdog.int.test.ts:82) |

## Finding details

### P1-1 — The watchdog mutates DEMO boards

**Evidence:** All three watchdog rules operate globally:

- Stale calls are selected solely by `status='dialing'`, without joining or excluding DEMO searches ([watchdog.ts:112](/Users/marvin/hackathon/lib/commands/watchdog.ts:112)).
- Stuck transcript rows are similarly global ([watchdog.ts:205](/Users/marvin/hackathon/lib/commands/watchdog.ts:205)).
- The deadline sweep includes every active search, including DEMO ([settle_expiry.sql:20](/Users/marvin/hackathon/supabase/migrations/20260726080000_settle_expiry.sql:20)).

A newly created DEMO board contains a five-minute-old `dialing` row and a `transcript_ready` row ended 0.3 minutes ago ([demo-fixtures.ts:69](/Users/marvin/hackathon/lib/domain/demo-fixtures.ts:69)). `createDemoSearch` does not store a transcript for the latter ([demo_search.ts:103](/Users/marvin/hackathon/lib/commands/demo_search.ts:103)).

**Failure scenario:** Roughly 72 seconds after board creation, the synthetic transcript row crosses the 90-second threshold and is sent through the real extraction path with a null transcript. Roughly five minutes later, the fake dialing row reaches the 600-second abandonment rule and becomes `unreached`. At the 14-minute deadline, the remaining queued fixture expires and the DEMO search completes. The video fallback is therefore neither inert nor stable.

The watchdog test hides this: its setup expires all existing global non-terminal rows before exercising the watchdog ([watchdog.int.test.ts:123](/Users/marvin/hackathon/tests/watchdog.int.test.ts:123)).

**Suggested fix:** Exclude `searches.dial_mode='DEMO'` in every watchdog rule, including the SQL deadline sweep and final drain-settle scan. Add an integration test that creates a real `createDemoSearch` fixture, runs several future ticks, and proves every search/call row remains unchanged and no provider or extraction dependency is invoked.

### P1-2 — Disposable owners defeat the abuse guard

**Evidence:** `getSupabaseClient()` constructs a new client each time with `persistSession:false` ([supabase-browser.ts:13](/Users/marvin/hackathon/lib/integrations/supabase-browser.ts:13)). It is called inside every engine `start()` ([live-engine.ts:56](/Users/marvin/hackathon/lib/search/live-engine.ts:56)); that fresh client has no session and signs in anonymously again ([live-engine.ts:96](/Users/marvin/hackathon/lib/search/live-engine.ts:96)).

The unique index only prevents two active non-DEMO searches for the same UID ([20260726082000_one_active_search.sql:12](/Users/marvin/hackathon/supabase/migrations/20260726082000_one_active_search.sql:12)). The route correctly obtains the UID through `auth.getUser`, so direct owner spoofing is prevented ([search route:31](/Users/marvin/hackathon/app/api/search/route.ts:31)); the defect is that the legitimate client continually obtains new UIDs.

The advertised 409 resume also does not exist in the client: every non-2xx response returns before parsing `searchId` ([live-engine.ts:119](/Users/marvin/hackathon/lib/search/live-engine.ts:119)).

**Failure scenario:** A single browser can reset, resubmit, reload, or open tabs and create many independent active REAL searches. The partial index never sees the same owner twice. Even the cited upstream allowance of 30 anonymous sign-ins per IP per hour would permit materially more real calls than appropriate; distinct searches can walk the 50 seeded pharmacy numbers despite the per-number lock.

**Suggested fix:** Maintain one module-level browser client and persist the anonymous session. Add a stable server-issued search identity or idempotency key, plus a server-side IP/device and REAL-call budget independent of Supabase authentication. Parse 409 responses and actually reconnect to the returned search. For today, gate live search creation to the trusted verification operator.

### P1-3 — The advisory lock does not cover the whole terminal action

**Evidence:** A failure first commits `dialing→unreached` through a direct REST update, then invokes the separately locked promotion and settlement RPCs ([record_call_event.ts:125](/Users/marvin/hackathon/lib/commands/record_call_event.ts:125)). The watchdog helper has the same structure ([watchdog.ts:97](/Users/marvin/hackathon/lib/commands/watchdog.ts:97)). Extraction commits its terminal status before separately promoting a bucket-4 replacement ([extract_result.ts:135](/Users/marvin/hackathon/lib/commands/extract_result.ts:135)).

`promote_bench` and `settle_if_drained` each acquire the advisory lock, but in different transactions ([audit_fixpack.sql:108](/Users/marvin/hackathon/supabase/migrations/20260726070000_audit_fixpack.sql:108), [audit_fixpack.sql:132](/Users/marvin/hackathon/supabase/migrations/20260726070000_audit_fixpack.sql:132)).

**Failure scenario:** Search S has one final dialing call A and one queued bench call B. A commits as terminal. Before its promotion RPC begins, another watchdog/webhook path runs `settle_if_drained`. It sees no in-flight or non-bench queued row, expires B, and completes S. A’s subsequent promotion finds nothing. The replacement is lost and the board completes prematurely.

Expected-status updates prevent a single call from double-transitioning, but they do not close this cross-transaction gap.

**Suggested fix:** Replace the direct update plus two RPC calls with one locked SQL command that conditionally performs the terminal transition, promotes exactly one replacement, and settles only after promotion. Return the actions taken so dispatch happens only if promotion succeeded.

### P1-4 — Watchdog timing and capacity claims are false

**Evidence:** Stale provider lookups run serially ([watchdog.ts:119](/Users/marvin/hackathon/lib/commands/watchdog.ts:119)); each GET can consume ten seconds ([elevenlabs.ts:37](/Users/marvin/hackathon/lib/integrations/elevenlabs.ts:37)). Eight legitimate in-flight calls can therefore require approximately 80 seconds before extraction or settlement begins. Stuck extractions are also serial and may each make three LLM attempts. The deadline sweep is last.

The route declares a 60-second maximum ([watchdog route:8](/Users/marvin/hackathon/app/api/internal/watchdog/route.ts:8)), while pg_net times out after 55 seconds ([setup-watchdog.sql:28](/Users/marvin/hackathon/scripts/setup-watchdog.sql:28)).

The `<90s` arithmetic is also incorrect. A call just under 30 seconds old at a cron tick is skipped; at the next tick it is nearly 90 seconds old before its GET starts. One ten-second GET already breaches 90 seconds, and an item behind seven other GETs can be much later.

At intended capacity the system can issue up to eight GETs per minute, or 480/hour. DEMO, legacy, or stuck rows make that unbounded. There is no tick lease, row limit, cursor, or overall deadline, so overlapping HTTP ticks can repeat the same work.

**Failure scenario:** A provider slowdown leaves eight calls processing. The watchdog request is terminated before reaching the sweep, so expired searches remain active and boards freeze. Subsequent cron invocations repeat the same lookups.

**Suggested fix:** Run the cheap deadline sweep first. Use bounded parallel provider lookups with a strict per-tick deadline, row limit, cursor, and database lease. Separate reconciliation and extraction into durable jobs. Test real elapsed behavior with eight ten-second lookups and verify the last call and sweep finish inside the deployment envelope.

### P1-5 — Ambiguity is treated as definite failure

**Evidence:** A single conversation GET `404` immediately invokes `markUnreachedAndRefill` ([watchdog.ts:183](/Users/marvin/hackathon/lib/commands/watchdog.ts:183)). The code itself concedes that it cannot prove the call never rang. Separately, an ambiguous outbound POST with no conversation ID is changed to `unreached` after 600 seconds based solely on elapsed time ([watchdog.ts:120](/Users/marvin/hackathon/lib/commands/watchdog.ts:120)).

Both paths free a slot, promote the bench, and may dispatch another pharmacy.

**Failure scenario:** ElevenLabs accepts an outbound call and returns a conversation ID, but its conversation lookup is temporarily eventually consistent and responds 404 at 30–90 seconds. Relay declares the call dead and calls a replacement pharmacy while the original call may still be ringing. A later genuine transcription is stored as raw evidence but its expected-status transition no-ops because the row is already `unreached`.

**Suggested fix:** Treat a 404 as ambiguous unless corroborated by repeated observations after a documented provider consistency window. Age alone must not convert a missing conversation ID into definite failure. Retain the slot/number lock or move to a distinct `ambiguous` state that cannot produce a stock verdict or replacement dial without definite provider evidence.

### P1-6 — Unknown provider states stall forever

**Evidence:** Only exact `done` and `failed` statuses are recognized. Every other value—including a missing status or a future contract value—is mapped to `in_progress` ([elevenlabs.ts:46](/Users/marvin/hackathon/lib/integrations/elevenlabs.ts:46)). The watchdog silently continues for `in_progress` ([watchdog.ts:134](/Users/marvin/hackathon/lib/commands/watchdog.ts:134)).

The deadline sweep deliberately refuses to settle while a `dialing` row exists ([settle_expiry.sql:29](/Users/marvin/hackathon/supabase/migrations/20260726080000_settle_expiry.sql:29)). No later rule ends a conversation that remains “processing”.

**Failure scenario:** A provider response changes from `processing` to `post_call_processing`, omits `status`, or remains processing because of an internal fault. The row is queried every minute forever. Eight such rows consume the global cap, all parent searches remain active, their owners are blocked by the unique index, and the live board freezes.

**Suggested fix:** Allowlist documented live states separately from unknown states. Log unknown values with their sanitized response shape. Define a provider-backed terminal policy for permanently stuck conversations; do not use elapsed time alone to infer that a call never happened.

### P2-1 — Flip and migration locks are not complete dial barriers

**Evidence:** `dispatch` claims rows under the RPC’s advisory lock, but the lock is released before number resolution and the external outbound POST ([dispatch.ts:79](/Users/marvin/hackathon/lib/commands/dispatch.ts:79), [dispatch.ts:117](/Users/marvin/hackathon/lib/commands/dispatch.ts:117)). Neither the pre-POST update nor the success update rechecks call/search status.

`flip_cancel_non_terminal` can therefore expire the row after claim but before POST. The script also runs the sweep before a separate manual environment edit and redeployment ([flip-dial-mode.ts:29](/Users/marvin/hackathon/scripts/flip-dial-mode.ts:29), [flip-dial-mode.ts:37](/Users/marvin/hackathon/scripts/flip-dial-mode.ts:37)).

Additionally, the c5 partial-index migration completes every active non-DEMO search through a plain update without acquiring lock `880042` or expiring its children ([20260726082000_one_active_search.sql:8](/Users/marvin/hackathon/supabase/migrations/20260726082000_one_active_search.sql:8)).

**Failure scenario:** A dispatch obtains a DEV_TEST claim, the flip sweep reports a clean slate, and the old process then sends the provider POST anyway. The row remains expired, but a call was placed after the claimed barrier. A new DEV_TEST search can also enter during the manual deploy gap. The migration can similarly complete a search while a claim or dispatch is in progress.

**Suggested fix:** Disable dialing before the sweep, wait for dispatch leases to drain, then sweep, change mode, deploy, and sweep again before reenabling. Introduce a database flip epoch or dispatch lease that must still match immediately before the provider POST. Acquire the advisory lock in the index migration and expire children consistently.

### P2-2 — Bucket-4 payload is client-readable

**Evidence:** Refused, incomplete, or unclear outcomes are written as `status='verdict'`, bucket 4, with a non-null verdict object containing `stock_status:'unclear'`, quantity, ETA, shortage, and outcome fields ([verdict.ts:105](/Users/marvin/hackathon/lib/domain/verdict.ts:105), [verdict.ts:143](/Users/marvin/hackathon/lib/domain/verdict.ts:143)). The database constraint expressly allows this ([audit_fixpack.sql:22](/Users/marvin/hackathon/supabase/migrations/20260726070000_audit_fixpack.sql:22)).

The client is granted and selects `verdict`. Presentation currently hides the payload, but it is visible to browser code and developer tools. The unit test explicitly canonizes this behavior ([verdict.test.ts:158](/Users/marvin/hackathon/tests/verdict.test.ts:158)).

**Failure scenario:** An unclear or refused call exposes structured quantity/ETA fields despite no verified stock conclusion. A future UI or consumer can accidentally treat those fields as evidence.

**Suggested fix:** Store `verdict=null` for all bucket-4 outcomes and keep provenance in the service-only extraction column. Enforce `rank_bucket=4 → verdict IS NULL` in the database and reverse the current regression test.

### P2-3 — Provider analysis contaminates transcript-only extraction

**Evidence:** The webhook interpreter stores one object containing both `transcript` and provider `analysis` ([record_call_event.ts:100](/Users/marvin/hackathon/lib/commands/record_call_event.ts:100)). `extractResult` passes that complete object as the transcript input to the LLM ([extract_result.ts:78](/Users/marvin/hackathon/lib/commands/extract_result.ts:78)). This contradicts the prompt’s explicit claim that the extractor re-derives truth from the transcript and never trusts the agent summary ([extraction.ts:1](/Users/marvin/hackathon/lib/prompts/extraction.ts:1)).

The watchdog-synthesized done payload includes the same `analysis` field, so its shape matches the real interpreter but preserves the same defect.

**Failure scenario:** The actual transcript says the pharmacist could not confirm stock, while provider analysis summarizes “medication available”. Both appear in the extraction input, allowing a summary hallucination to influence a false stock verdict.

**Suggested fix:** Store provider analysis separately as service-only evidence and pass only the normalized transcript turns to `extractionUserPrompt`. Add an adversarial test where transcript and analysis conflict and prove the transcript wins.

### P3-1 — Synthesized events lack raw append-only evidence

**Evidence:** Real webhooks insert the verified payload and raw body into `call_events` before interpretation ([webhook route:106](/Users/marvin/hackathon/app/api/webhooks/elevenlabs/route.ts:106)). `recordCallEvent` explicitly documents that precondition ([record_call_event.ts:5](/Users/marvin/hackathon/lib/commands/record_call_event.ts:5)).

The watchdog constructs an event in memory and calls `recordCallEvent` directly ([watchdog.ts:139](/Users/marvin/hackathon/lib/commands/watchdog.ts:139)). It records an anomaly afterwards, but not the provider GET response, synthesized payload, or a dedupe key in the raw-event ledger.

**Failure scenario:** A rescued verdict cannot later be reconstructed from immutable event evidence or distinguished from a changed provider response. This weakens incident review and auditability, though expected-status updates still prevent duplicate state transitions.

**Suggested fix:** Persist a service-only reconciliation event—including provider response, observation timestamp, source, and deterministic dedupe key—before invoking `recordCallEvent`.

### P3-2 — Cron setup is operationally fragile

**Evidence:** The documented command wraps psql variables in SQL quotes on the command line and then performs raw `:secret` substitution ([setup-watchdog.sql:5](/Users/marvin/hackathon/scripts/setup-watchdog.sql:5), [setup-watchdog.sql:31](/Users/marvin/hackathon/scripts/setup-watchdog.sql:31)). A secret containing an apostrophe breaks the cast and can alter the SQL. Substituting the real secret directly also leaves it in shell history and process arguments.

The job performs one asynchronous HTTP enqueue per minute. If the application is down or the request times out, the next minute naturally tries again, but there is no same-tick retry, backoff, failure query, or alert. Named scheduling appears intended to make reruns idempotent, but that depends on the installed cloud pg_cron overload/version and was not proven locally.

**Suggested fix:** Use psql literal quoting (`:'secret'`) or `\getenv`, preferably referencing a database/Vault-held secret rather than embedding it in cron command text. Add a monitored query over pg_net failures and an alert when consecutive ticks fail.

### P3-3 — Green tests overstate the acceptance evidence

**Evidence:**

- Watchdog calls are seeded three minutes stale, so the old 120-second default would also pass; the test does not measure rescue time ([watchdog.int.test.ts:91](/Users/marvin/hackathon/tests/watchdog.int.test.ts:91)).
- Provider lookups and extraction are instant injected functions, bypassing route and cron duration constraints ([watchdog.int.test.ts:143](/Users/marvin/hackathon/tests/watchdog.int.test.ts:143)).
- Watchdog setup deletes all foreign non-terminal state, masking DEMO interaction.
- Flip tests are sequential and never overlap claim, dispatch POST, sweep, and deploy.
- Concurrent-submit tests call `createSearch` twice with the same artificial UUID; they do not exercise browser session creation, JWT routing, 409 handling, or reloads ([abuse-guards.int.test.ts:81](/Users/marvin/hackathon/tests/abuse-guards.int.test.ts:81)).

The RLS test is materially stronger: it creates two real anonymous sessions, has owner positive controls, proves transcript/extraction column denial, proves stranger selects return zero, and requires owner realtime delivery while the stranger remains silent ([rls-two-sessions.int.test.ts:112](/Users/marvin/hackathon/tests/rls-two-sessions.int.test.ts:112)). Its one-second post-owner-delivery grace window is not standalone proof of permanent silence, but the deterministic RLS policy and SELECT checks make it useful corroboration.

**Suggested fix:** Add the adversarial races and full browser/session lifecycle to integration tests; test watchdog timing through the route with eight delayed provider responses; retain the existing RLS test.

## c5d5969 internal-fix verification

| Internal-review fix | Result | Verification |
|---|---|---|
| Partial unique index closes concurrent same-owner submit | **HOLDS narrowly** | Exactly one active non-DEMO row per fixed owner is enforced. Disposable browser owners bypass the broader guard, and the migration backfill is unlocked. |
| Watchdog default reduced from 120s to 30s | **DOESN’T HOLD** as a `<90s` guarantee | The default changed, but cron phase, GET latency, serial processing, and route limits make the stated bound false. |
| Flip expiry edges added to state-machine docs | **HOLDS** | The documentation now describes queued/dialing/transcript-ready expiry during the explicit flip. |
| `createDemoSearch` reuse restricted to DEMO | **HOLDS** | The reuse query now includes `dial_mode='DEMO'`; it no longer hijacks a LIVE board. |
| Anomaly-insert failures surfaced | **HOLDS** | Insert failures are logged and do not abort the tick. |
| Shared unreached/refill helper and `abandoned` counter | **HOLDS mechanically** | The paths and counter are shared, but their age/404 terminal policy violates fail-safe semantics. |
| IP guard replaced by documented Supabase anonymous-rate bound | **DOESN’T HOLD** | The edit is disclosed, but the app itself creates new anonymous owners and the stated upstream allowance is not a safe REAL-call abuse bound. |
| `env-local` and duplication cleanup | **HOLDS** | Mechanical cleanup is present; it does not change the safety conclusions. |

## Acceptance-criteria audit

| Step | Verdict | Audit |
|---|---|---|
| **4.1 settle + expiry** | **MET WITH CAVEATS** | The locked RPC correctly expires queued rows, preserves in-flight rows, and settles when drained in sequential tests. It also touches DEMO searches, and a forever-`in_progress` row leaves a search active forever. The original criterion was not materially weakened. |
| **4.2 watchdog** | **NOT MET** | Same interpreter machinery is used for rescued events, but DEMO isolation, fail-safe ambiguity, `<90s` rescue, execution-envelope safety, raw evidence, and eventual termination are not met. The 30-second edit is disclosed; the resulting checkmark is unsupported by its test. |
| **4.3 anonymous auth + RLS** | **MET WITH CAVEATS** | JWT-derived ownership, RLS separation, and transcript/extraction denial are supported by meaningful local tests. Browser session continuity is broken, and the tracker’s claimed human/prod check is external evidence not verifiable here. |
| **4.4 abuse guards** | **NOT MET** | INTERNAL_SECRET and the fixed-owner uniqueness race hold, but one active search “per session” is defeated by the shipped session lifecycle and the client does not resume on 409. The original `session/IP` criterion was explicitly weakened to session-only; the disclosure is honest, the safety rationale is not. |
| **4.5 DEV_TEST→REAL flip** | **NOT MET** end-to-end | The sequential cancellation RPC and REAL claim gates work, and the added state-machine edges honestly document the database transition. The ritual does not fence already-claimed dispatches or new searches during the manual deployment gap. |

## Verified green

- `settle_expired_searches`, `flip_cancel_non_terminal`, `claim_next_dials`, `promote_bench`, and `settle_if_drained` acquire advisory lock `880042`; client roles are denied access to the service RPCs.
- REAL claims require an active same-mode search, age under 20 minutes, valid current hours plus 60-minute stay-open, verified non-`dev_test` pharmacy, free phone-hour lock, global/per-search caps, and remaining attempt budget ([audit_fixpack.sql:201](/Users/marvin/hackathon/supabase/migrations/20260726070000_audit_fixpack.sql:201)).
- DEMO searches are neither claimable nor counted in the global dialing cap. This remains true despite the separate watchdog mutation defect.
- The search route derives owner identity through `auth.getUser`; no client owner field is trusted.
- INTERNAL_SECRET is fail-closed when unset, shorter than 16 characters, missing, or wrong. Equal-length values use `timingSafeEqual`; only the watchdog route exists below `/api/internal`.
- The synthesized watchdog payload has the fields actually consumed by `recordCallEvent`: event type, conversation ID, call reference, transcript, and analysis.
- A real delayed webhook and a synthesized done webhook racing on the same `dialing` call cannot both transition it: the expected-status update permits only one winner. Late/duplicate events after flip or expiry record raw evidence but cannot resurrect the call or trigger downstream dispatch.
- Initiation failures become `unreached`, not stock verdicts. Verified stock buckets 1–3 are constrained to their matching structured stock status.
- RLS grants exclude `transcript` and `extraction`; call events, dial logs, and anomalies are not exposed to client roles. No Phase 4 transcript or PII leak was found.
- The user-supplied results report typecheck, all 137 tests, build, database reset, and 17-state proof green. Inspection found no contradiction in the narrow assertions those checks execute.

## Not verifiable in this audit

- Whether all migrations, `INTERNAL_SECRET`, watchdog cron job, `DIAL_MODE`, and `DIALING_ENABLED` are currently deployed and correctly configured in cloud production.
- Whether the 50 seeded pharmacies’ phone numbers, Sunday hours, verification flags, and spot-call outcomes are correct.
- The actual ElevenLabs status vocabulary, 404 consistency semantics, provider rate/cost limits, maximum call duration, or current webhook behavior.
- The cloud pg_cron/pg_net version, named-job update semantics, job health, response history, or failure retention.
- Vercel cold-start and termination behavior beyond the declared route duration.
- The claimed human two-browser production check and any real provider calls.
- Any behavior outside the specified commit range or dependent infrastructure not represented in the repository.