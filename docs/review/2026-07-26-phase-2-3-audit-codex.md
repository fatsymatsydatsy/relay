<!-- Provenance: codex CLI v0.145.0 · model gpt-5.6-sol · reasoning effort xhigh · sandbox read-only · session 019f9cd1-559e-7772-90a2-f10f523caa5c · run 26 Jul 2026 ~06:06-06:35 BST against clean tree at da37a75. Machine checks (typecheck green, 81/81 vitest incl. integration vs local stack, build green) were run by Claude immediately before launch and supplied to the auditor as given. Claude spot-verified the cited lines of P1-1/P1-2/P1-3/P1-4/P1-6 against the working tree after delivery. -->

# Adversarial audit — Relay, Phases 2 & 3

## 1. Scope and method

- **Date:** 26 Jul 2026
- **Commit range:** `e3d7455..da37a75`
- **Resolved HEAD:** `da37a75c9c96ef2ac943c2b93fa0260acbfe988c`
- **Working tree:** clean according to `git status --short`
- **Method:** read-only inspection of governing documents, the full diff, current production code, migrations, grants/RLS, scripts, evidence, and every named test.
- **Read-only checks run:** `git rev-parse`, `git log`, `git diff --stat`, `git diff --name-status`, `git show`, `rg`, `sed`, `nl`, and file listings.
- **Not run:** tests, build, migrations, SQL proof scripts, network requests, cloud queries, or real calls.
- **Given machine results accepted:** typecheck green; 81/81 tests green against the running local stack; build green. This audit evaluates what those checks actually prove.

## 2. TL;DR verdict

**No — Phases 2–3 are not sound enough for today’s REAL run as committed.**

The largest immediate blocker is missing mode isolation. `create_search` ranks and cache-copies DEV_TEST pharmacies without knowing the requested dial mode. The repository seeds 24/7 fake pharmacies in B5, so those rows can occupy a REAL search’s top-six slots while verified real pharmacies remain bench. A recent fake verdict can also be copied directly onto the REAL board without ever reaching dispatch’s REAL-mode guard.

There are additional release-blocking failures:

- The locked claim does not re-enforce the one-hour stay-open rule.
- Bench promotion and drain-settle are race-prone, and actual schema exhaustion does not promote the bench.
- The client receives verbatim transcript excerpts inside `verdict.notes`.
- There is no total attempt ceiling or active deadline guard, so repeated dead ends can dial every open candidate.
- The nominal global cap is caller-configurable above eight.
- Persisted webhook events have at-most-once interpretation with no durable replay path.

The pure resolver and the normal wrong/unconfirmed verdict path are solid. The vertical-slice happy path demonstrably worked in DEV_TEST according to the supplied evidence. Those positives do not make the REAL path safe.

## 3. Findings summary

| ID | Severity | Summary | Primary location |
|---|---|---|---|
| P1-1 | P1 | Search, cache, demo, and dial modes are not isolated; REAL can surface or be blocked by DEV_TEST data | `lib/commands/create_search.ts:86` |
| P1-2 | P1 | The locked claimer omits the one-hour stay-open rule and uses weaker hours validation | `supabase/migrations/20260726052000_claim_next_dials.sql:89` |
| P1-3 | P1 | Bench promotion and drain-settle are non-atomic; schema exhaustion does not promote | `lib/commands/record_call_event.ts:143` |
| P1-4 | P1 | Verbatim transcript excerpts are returned to the browser | `lib/domain/verdict.ts:114` |
| P1-5 | P1 | No total attempt ceiling or deadline gate prevents dialing every open candidate | `lib/domain/portfolio.ts:131` |
| P1-6 | P1 | The “≤8 global” cap is unvalidated and can be configured above eight | `lib/commands/dispatch.ts:55` |
| P1-7 | P1 | Webhook dedupe creates at-most-once processing with no durable recovery | `app/api/webhooks/elevenlabs/route.ts:105` |
| P2-1 | P2 | Eventless paths—cached searches and definite provider rejections—can remain active indefinitely | `lib/commands/dispatch.ts:125` |
| P2-2 | P2 | Medication identity and quantity normalization can report the wrong formulation or amount | `lib/commands/create_search.ts:65` |
| P2-3 | P2 | DB constraints do not tie buckets to their corresponding payloads | `supabase/migrations/20260726000001_init.sql:91` |
| P2-4 | P2 | The supermarket quota fails for a same-chain swap that would preserve the chain cap | `lib/domain/portfolio.ts:153` |
| P2-5 | P2 | The named BST test does not cover either DST transition; spring-forward breaks the real-hour buffer | `lib/domain/opening-hours.ts:113` |
| P3-1 | P3 | Named tests materially overstate what they prove | `tests/dispatch.stress.int.test.ts:177` |

## 4. Detailed findings

### P1-1 — Search, cache, demo, and dial modes are not isolated

**Evidence**

`createSearch` reads every pharmacy without source or verification filtering:

```ts
const { data: pharmacies } = await db
  .from("pharmacies")
  .select("ods_code, name, lat, lng, hours, ownership_group, is_supermarket");
```

`lib/commands/create_search.ts:86-97`

The search command does not receive or persist a dial mode. REAL filtering happens only much later:

```sql
and ((p_dial_mode = 'DEV_TEST' and p.source = 'dev_test')
  or (p_dial_mode = 'REAL' and p.verified and p.source <> 'dev_test'))
```

`supabase/migrations/20260726052000_claim_next_dials.sql:90-92`

Cache copying also lacks `dial_mode`, `source`, or `verified` checks:

```ts
const cache = cacheByOds.get(t.ods);
if (cache) {
  return { status: "verdict", verdict: cache.verdict, ... };
}
```

`lib/commands/create_search.ts:186-243`

The repo seeds ten 24/7 DEV_TEST pharmacies around B5:

`script/seed-fake-board.sql:35-71`

The slice evidence says those B5 fake rows were used in the deployed pipeline:

`evidence/2026-07-26-slice-3.5.md:3-5`

There is a second mode leak: `createDemoSearch` writes synthetic `queued` and `dialing` calls into the same tables:

`lib/commands/demo_search.ts:98-111`

Those synthetic `dialing` rows count against the global cap because the SQL counts every dialing row before applying any mode predicate:

`supabase/migrations/20260726052000_claim_next_dials.sql:76`

A queued demo row is eligible for an actual DEV_TEST dispatch because it is active, non-bench, open, and `source='dev_test'`.

**Failure scenario**

A REAL B5 search ranks fake 24/7 pharmacies highly because they are nearby, have maximal weekly hours, and may have strong verdict history. They occupy some or all top-six target slots. Dispatch refuses them, but verified real pharmacies remain `is_bench=true` and cannot be claimed. The board stays queued.

If a fake same-medication verdict is less than one hour old, `create_search` copies it as a completed verdict before dispatch. The patient sees simulated stock as a REAL result.

Separately, synthetic demo rows can consume REAL global capacity or be dialed during DEV_TEST despite the demo command’s “never dials” contract.

**Suggested fix**

Persist `searches.dial_mode` and `searches.kind` (`real`, `dev_test`, `demo`). Filter candidates and cache sources inside `create_search`, require the same mode/kind in the locked claim, exclude demo rows from capacity counts, and never let demo rows enter the dialable state machine.

Until fixed, REAL must not run in a database containing in-radius DEV_TEST rows.

---

### P1-2 — The locked claimer omits the one-hour stay-open rule

**Evidence**

The pure portfolio filter correctly checks a 60-minute horizon:

```ts
if (!isOpenAt(c.hours, now)) { ... }
else if (!staysOpenFor(c.hours, minStayOpenMinutes, now)) { ... }
```

`lib/domain/portfolio.ts:71-80`

The SQL claimer checks only open at the current minute:

```sql
and pharmacy_open_now(p.hours, p_at)
```

`supabase/migrations/20260726052000_claim_next_dials.sql:86-90`

Its parser merely casts hour and minute pieces. It does not enforce the TypeScript validator’s `00:00..24:00`, minute bounds, shape, or `open < close` rules:

`supabase/migrations/20260726052000_claim_next_dials.sql:28-40`

The stress test explicitly expects a closed row to remain `queued`:

`tests/dispatch.stress.int.test.ts:226-232`

That contradicts the documented state transition `queued → skipped: closed at dial time`:

`docs/architecture.md:41-44`

**Failure scenario**

A pharmacy closing at 17:00 is admitted at 16:00 because it satisfies exactly 60 minutes. It waits on the bench until 16:35, then is promoted and dialed with only 25 minutes left.

At a `24:00` close, the row can be claimed immediately before midnight and POSTed after midnight, when the pharmacy is closed. Invalid changed hours such as `["09:00","99:00"]` can also be treated as open by SQL.

A closed or hour-locked target is merely ignored, not marked skipped and replaced, so it can also keep a search queued forever.

**Suggested fix**

Implement one fail-closed, timezone-aware SQL eligibility function inside the advisory-locked claim. It must validate the full hours shape, prove continuous opening for 60 actual minutes, and atomically mark newly ineligible targets `skipped` while promoting replacements.

---

### P1-3 — Bench promotion and drain-settle are non-atomic

**Evidence**

Promotion is an unlocked SELECT followed by UPDATE:

```ts
const { data: next } = await db.from("calls")
  .select("id")
  .eq("is_bench", true)
  .limit(1)
  .maybeSingle();

await db.from("calls")
  .update({ is_bench: false })
  .eq("id", next.id);
```

`lib/commands/record_call_event.ts:143-158`

Drain-settle is another independent read-then-write sequence:

`lib/commands/record_call_event.ts:171-195`

Actual extraction/schema exhaustion does not promote the bench:

```ts
if (!extraction) {
  await db.from("calls")
    .update({ status: "extraction_failed", rank_bucket: 4 });
  await settleIfDrained(...);
}
```

`lib/commands/extract_result.ts:108-123`

Promotion exists only after a successfully parsed bucket-4 extraction:

`lib/commands/extract_result.ts:148-154`

**Failure scenario**

Two of three parallel calls terminate together. Both handlers select the same top bench row before either UPDATE commits. Only one replacement is promoted for two dead calls.

Worse, drain-settle can read the bench before either promotion, expire it, and mark the search complete. The patient gets a completed search after fewer checks than intended.

If the extractor exhausts its three attempts, it settles immediately without any replacement even in the absence of a race.

**Suggested fix**

Move terminal transition, exactly-one bench promotion, dispatch eligibility, and drain-settle into transactional SQL under the same advisory lock. Use `FOR UPDATE SKIP LOCKED` or one `UPDATE … WHERE id=(SELECT … FOR UPDATE) RETURNING`. Promote after guarded `extraction_failed` transitions as well.

---

### P1-4 — Verbatim transcript excerpts reach the browser

**Evidence**

The extractor stores the first notable quote in the public verdict object:

```ts
notes: x.notable_quotes[0] ?? null,
```

`lib/domain/verdict.ts:114-115`

Clients receive the whole `verdict` JSONB:

```sql
grant select (..., verdict, ...)
  on calls to anon, authenticated;
```

`supabase/migrations/20260726000001_init.sql:210-214`

The live browser query explicitly selects it:

`lib/search/live-engine.ts:126-132`

**Failure scenario**

A pharmacist volunteers a name, phone number, or other personal detail in the short quote used to justify the verdict. That verbatim transcript excerpt is returned in the browser’s JSON even though the UI does not render it.

Owner-scoped RLS does not solve this: the patient’s own browser still receives unrelated pharmacy-staff PII.

**Suggested fix**

Keep notable quotes and notes in a service-only table or column. Expose a narrow public verdict projection containing only approved structured fields. Do not grant a client the entire service-owned JSONB document.

---

### P1-5 — No total attempt ceiling or active deadline gate

**Evidence**

The portfolio deliberately places every surviving non-target candidate on the bench:

```ts
const bench = overflow.sort(byRank);
```

`lib/domain/portfolio.ts:131-133`

The test codifies “bench holds everyone”:

`tests/portfolio.test.ts:163-175`

Every dead call promotes another row:

`lib/commands/record_call_event.ts:134-158`

The claim checks `search.status='active'` but not `deadline_at` or an attempt count:

`supabase/migrations/20260726052000_claim_next_dials.sql:86-101`

This contradicts the documented “~12-attempt ceiling”:

`docs/architecture.md:84-90`

**Failure scenario**

A five-kilometre radius contains 40 open pharmacies. Repeated voicemail, refusal, and wrong-branch outcomes promote all 34 bench rows. With Phase 4 deadline enforcement absent, the system can place 40 calls from one search, well beyond the intended cost and politeness budget.

The concurrent caps remain intact, but the total number of pharmacies burdened does not.

**Suggested fix**

Persist and enforce a hard per-search attempt budget inside the locked claim, for example 12. Limit the stored bench or track `attempts_claimed`. Also reject claims at or after `deadline_at`.

---

### P1-6 — The global cap is not hard

**Evidence**

The cap comes from unrestricted dependency/environment input:

```ts
const globalCap =
  deps.globalCap ?? Number(process.env.GLOBAL_CAP ?? 8);
```

`lib/commands/dispatch.ts:54-56`

It is passed directly to SQL:

`lib/commands/dispatch.ts:66-70`

The SQL exits only at the supplied value:

```sql
exit when l_global_inflight >= p_global_cap;
```

`supabase/migrations/20260726052000_claim_next_dials.sql:110`

The stress test supplies exactly `globalCap: 8` and never tries 9, 20, zero, or malformed configuration:

`tests/dispatch.stress.int.test.ts:181-190`

**Failure scenario**

`GLOBAL_CAP=20` permits 20 concurrent calls. There is no database-side ceiling at eight. That can consume the provider’s full capacity, trigger rejection storms, and exceed the project’s stated safety headroom.

The per-search parameter is likewise callable with values above three by a service-role caller.

**Suggested fix**

Make eight and three database-enforced maxima. Validate configuration before RPC, and apply `LEAST(p_global_cap, 8)` / `LEAST(p_per_search_cap, 3)` or remove the caller-controlled parameters entirely.

The fairness claim also needs work: the candidate query’s `ORDER BY` is formed from a snapshot before the loop, while live rechecks enforce only caps and phone locks. With global cap two and several empty searches, two high-ranked rows from one search can be claimed before any other search receives one.

---

### P1-7 — Webhook interpretation is at-most-once, not durably idempotent

**Evidence**

The route inserts the event, then schedules interpretation only if that insert was new:

```ts
const { error } = await serviceClient().from("call_events").insert(...);

if (!error) {
  after(async () => {
    await recordCallEvent(...);
  });
}
```

`app/api/webhooks/elevenlabs/route.ts:105-133`

A duplicate returns `23505` and is not interpreted. A non-duplicate insert error is logged, but the route still returns 200 and does not interpret it:

`app/api/webhooks/elevenlabs/route.ts:112-119`

Failures inside `after()` are logged only:

`app/api/webhooks/elevenlabs/route.ts:120-132`

**Failure scenario**

The raw event is inserted, but the deferred database transition fails once. The provider already received 200 and normally will not retry. If it does resend the identical payload, the unique key produces `23505`, and the route deliberately schedules nothing. The call remains `dialing` indefinitely because the Phase 4 watchdog is not present.

A transient event-insert failure is worse: the route returns 200 with neither raw evidence nor interpretation.

**Suggested fix**

Use a durable processing/outbox table separate from the append-only raw log. Record `pending` work transactionally, and let retries or a worker reprocess events until a guarded transition succeeds. A duplicate should check whether its processing record completed rather than being dropped unconditionally.

---

### P2-1 — Eventless paths can make no progress

**Evidence**

After definite rejection, dispatch frees the row and exits:

`lib/commands/dispatch.ts:125-139`

It does not schedule another dispatch or promote another target.

For cache copies, `create_search` leaves the search `active`, writes cached targets as `verdict`, and leaves the rest as bench:

`lib/commands/create_search.ts:169-179,227-259`

Dispatch cannot claim bench rows, and drain-settle is invoked only by webhook/extraction paths:

`lib/commands/record_call_event.ts:166-195`

**Failure scenario**

All initial ElevenLabs POSTs receive definite 4xx rejections. No call exists, so no webhook can wake dispatch. The rows are safely freed but the search remains queued.

Or all top-six targets are cached while additional candidates remain bench. No call is placed, no event fires, the bench remains queued, and the search stays active indefinitely.

**Suggested fix**

After definite frees, enqueue a bounded/backed-off dispatch wake rather than silently exiting. After queue creation, settle immediately when all non-bench rows are already terminal, expiring leftover bench. Avoid a hot same-number retry loop.

---

### P2-2 — Medication and quantity data can become falsely precise

**Evidence**

`create_search` constructs the spoken medication as only name plus dose and stores the form as `"unspecified"`:

```ts
const display = input.dose
  ? `${input.medication} ${input.dose}`
  : input.medication;

form: "unspecified",
```

`lib/commands/create_search.ts:65-79`

Dispatch passes that display directly to the voice agent:

`lib/commands/dispatch.ts:103-110`

That violates the authoritative requirement to say the full name, strength, and form.

The quantity normalizer accepts the first digits anywhere in the verbatim phrase:

```ts
const digits = /(\d+)\s*([a-z]+)?/.exec(text);
```

`lib/domain/verdict.ts:170-173`

It also converts `"few"` to exactly three:

`lib/domain/verdict.ts:154-158`

**Failure scenario**

A pharmacist is asked for “Creon 25,000” rather than “Creon 25,000 gastro-resistant capsules”, or for another drug without distinguishing tablets, capsules, patches, or modified-release form. They confirm a different formulation and the system stores a stock verdict.

If the quantity excerpt is “two boxes of the 25,000”, the digit-first parser returns 25, not two. The patient can be shown 25 boxes. “A few” is displayed as exactly three despite no such statement.

**Suggested fix**

Use a canonical medication/SKU identifier carrying name, strength, and form; do not construct the spoken identity from two free-text fields. Make quantity normalization conservative and unit-aware. Return `null` whenever the phrase is ambiguous and retain only the verbatim display.

---

### P2-3 — DB constraints do not tie bucket to payload

**Evidence**

Buckets 1–3 require only `status='verdict'`, confirmed location, and any non-null verdict:

`supabase/migrations/20260726000001_init.sql:91-111`

`presentCall` renders solely from `rank_bucket`:

```ts
if (row.rank_bucket === 1) return { phase: "in-stock", ... };
if (row.rank_bucket === 2) return { phase: "can-order", ... };
return { phase: "no-stock", bucket: 3, ... };
```

`lib/domain/call-presentation.ts:58-67`

**Failure scenario**

This row is accepted by the database:

```json
{
  "status": "verdict",
  "rank_bucket": 1,
  "location_confirmed": "yes",
  "verdict": { "stock_status": "unclear" }
}
```

The UI renders it as in stock. Bucket 2 with a non-orderable payload similarly renders “can order”.

Normal `mapExtraction` output is internally consistent, so this requires another service writer or future regression. That is why this is P2 rather than P1, but the claimed DB enforcement is incomplete.

**Suggested fix**

Add a bucket/payload CHECK matrix:

- bucket 1 ↔ `stock_status='in_stock'`
- bucket 2 ↔ `stock_status='orderable'`
- bucket 3 ↔ `stock_status='out_of_stock'`
- bucket 4/null ↔ no stock claim

Extend `prove-constraints.sql` with each mismatch.

---

### P2-4 — Supermarket quota fails on a valid same-chain swap

**Evidence**

An overflow supermarket is considered only if its chain currently has fewer than two targets:

```ts
.find(
  (c) =>
    c.ownershipGroup === "independent" ||
    chainCount(c.ownershipGroup) < MAX_PER_CHAIN,
);
```

`lib/domain/portfolio.ts:153-160`

**Failure scenario**

Two non-supermarket branches from chain A are already targets. A third chain-A candidate is the only supermarket. The algorithm rejects it because the chain count is two, even though replacing one existing chain-A non-supermarket with the supermarket would preserve the cap and meet the quota.

The existing test uses an otherwise unrepresented Asda chain and never exercises this case:

`tests/portfolio.test.ts:97-113`

**Suggested fix**

Evaluate incoming and outgoing candidates as a pair. Permit an incoming same-chain supermarket when the outgoing target belongs to that same chain. Add the exact regression fixture.

---

### P2-5 — Actual DST transitions are not covered and spring-forward breaks the buffer

**Evidence**

The test called `hours.bst-boundary` compares a July date with a January date:

`tests/opening-hours.test.ts:29-45`

It does not test either the March or October clock transition.

`staysOpenFor` subtracts London wall-clock minutes:

```ts
let remaining = parseTime(current[1])! - minutes;
```

`lib/domain/opening-hours.ts:113-120`

**Failure scenario**

On the 2026 spring-forward morning, a Sunday session is `00:00–02:00`. At 00:30 UTC, London wall time is 00:30; clocks jump from 01:00 to 02:00. Only 30 real minutes remain until the listed 02:00 close, but the function reports 90 minutes and allows the pharmacy through the one-hour filter.

The October direction is conservative in some repeated-hour cases, but it is also untested.

**Suggested fix**

Test both actual transition dates and compute the close as a timezone-aware instant. Compare elapsed UTC duration rather than subtracting wall-clock minute labels.

---

### P3-1 — Named tests overstate their proof

| Named test | Audit ruling |
|---|---|
| `dispatch.stress` | **Partial, not theater overall.** It performs real concurrent RPC calls and proves serialization/caps for valid input `8`. It does not test >8/malformed caps, fairness, a pre-existing one-hour lock, the one-hour stay-open buffer, REAL-mode contamination, bench races, or exact rejected-row recovery. Its setup expires all foreign in-flight rows, masking synthetic demo-state pollution (`tests/dispatch.stress.int.test.ts:140-155`). Its definite-free assertion queries any freed log in the DB rather than the newly claimed call IDs (`:272-276`). |
| `webhook.idempotent` | **Weak.** It calls `recordCallEvent` twice sequentially (`tests/record-call-event.int.test.ts:111-139`). It bypasses HMAC, raw insert, unique dedupe, `after()`, concurrent delivery, and out-of-order events. |
| `hours.bst-boundary` | **Misnamed.** It proves seasonal London offset handling, not either BST transition. |
| `bucket.wrong-location` | **Good for the application mapper.** It proves wrong/unconfirmed → bucket 4/null verdict and the presentation regression. It does not prove the complete DB bucket/payload matrix. |
| `bench.extraction-deadend` | **Partial.** It covers one sequential, successfully parsed wrong-branch result with a mocked dispatch counter (`tests/extract-result.int.test.ts:245-293`). It does not cover schema exhaustion, real claim/refill, or concurrent terminal events. |

All integration files contain a soft-pass branch when the local stack is unavailable. The user’s supplied run states that the stack was running, so this did not invalidate this particular 81/81 result; it does weaken the test command as a future standalone gate.

## 5. Acceptance-criteria audit

| Step | Claimed status | Audit verdict | Rationale |
|---|---:|---|---|
| 2.1 Opening hours | `[x]` | **Met with caveats** | Normal London/GMT conversion, lunch gaps, fail-closed TypeScript validation, ordinary `24:00`, and next opening are implemented. Actual DST transitions are not tested, and spring-forward breaks the real-hour buffer. |
| 2.2 Portfolio | `[x]` | **NOT met** | Scoring, determinism, independent quota, and normal chain caps are present. The same-chain supermarket case violates “≥1 supermarket when available”. Bench size is also unbounded. |
| 2.3 Verdict/buckets | `[x]` | **Met with caveats** | Normal mapper behavior and wrong/unconfirmed bucket-4 presentation are sound. Quantity normalization can fabricate amounts, verbatim quotes leak to clients, and DB bucket/payload constraints are incomplete. |
| 2.4 Dial resolution | `[x]` | **Met** | The pure resolver deterministically reroutes DEV_TEST, validates E.164, and refuses unverified or dev-test-sourced REAL targets. End-to-end mode isolation fails elsewhere, not in this function. |
| 3.1 `create_search` | `[x]` | **NOT met** | Normal queue, cache-copy timestamp, and zero-open paths exist. Mode-blind candidate/cache selection can poison REAL searches, and all-cached searches can remain active with bench rows. |
| 3.2 `dispatch` | `[~]` | **NOT met** | The `[~]` is substantively correct. The locked claim has genuine cap/phone serialization, but it lacks the stay-open horizon, bench promotion, hard cap ceilings, fair dynamic allocation, skipped-row transitions, and eventless recovery. Commit `c5d918b` did not meet the full criterion. Closing Phase 3 while 3.2 remains `[~]` violates the living status protocol. |
| 3.3 `record_call_event` | `[x]` | **NOT met** | Expected-status transitions, call-ref-first correlation, simple orphan handling, and sequential replay no-ops are present. Route-level durable idempotency and concurrent promotion/settle correctness are not. |
| 3.4 `extract_result` | `[x]` | **Met with caveats** | Strict schema parsing, the named model ladder, honest `extraction_failed`, and safe normal mapped verdicts exist. All operational errors count as schema attempts, actual failure does not refill the bench, and the replay script is a copied prompt rather than the real command. |
| 3.5 One slice | `[x]` | **Met with caveats** | The evidence is internally coherent and describes a successful six-call DEV_TEST slice. External DB/provider logs were unavailable, and the run does not prove REAL data isolation or adversarial concurrency. |
| 3.6 Full search | `[x]` | **NOT met** | The dress evidence itself records that three dead ends promoted no replacements. The subsequent fix covers parsed bucket-4 outcomes only, not extraction failure or webhook races, and was not rerun live. The named test does not close that gap. |

### Explicit 3.2 ruling

**3.2 is not complete.** The remaining `[~]` is not merely stale bookkeeping. The commit implements an important serialized reservation core, but its full written criteria—especially bench promotion inside the claim, hard ≤8 enforcement, stay-open safety, and fairness—are not met.

## 6. Verified green

The following were positively confirmed by static inspection:

- `pg_advisory_xact_lock(880042)` is transaction-scoped and serializes the claim RPC.
- With valid caps, the claim rechecks per-search count and phone reservation before each UPDATE/insert.
- The intended pharmacy number is reserved in `dial_log` within the claim transaction.
- Network timeouts and 5xx responses remain `dialing`/reserved; injected definite failures use the freed lifecycle.
- REAL mode is rejected for unverified and `dev_test` pharmacies in both SQL and `resolveDialNumber`.
- Pharmacy, intended, and resolved phone fields have E.164 checks.
- Wrong or unconfirmed branch output maps to bucket 4 with `verdict=null`.
- `presentCall` renders verdict-status bucket-4 rows as unverified.
- Initiation failures become `unreached`, bucket 4, with no verdict payload.
- HMAC verification uses the raw body, timestamp tolerance, and timing-safe comparison.
- Every in-handler webhook path has a 200 backstop.
- Normal webhook transitions use `UPDATE … WHERE status='dialing'`.
- Correlation prefers the system’s `call_ref` over `conversation_id`.
- Full transcripts are immutable after first write.
- `call_events` and raw dial history have update/delete guards.
- Full transcript, `call_events`, `dial_log`, and `anomalies` are not client-granted.
- Owner-scoped RLS policies exist for searches and calls.
- Extraction uses `gpt-5.4-mini`, `gpt-5.4-mini`, then `gpt-5.6-sol`.
- Schema exhaustion stores `extraction_failed`, bucket 4, with no fabricated verdict.
- The supplied typecheck, 81/81 test, and build results are accepted as green for this exact tree, though they were not rerun here.

## 7. Not verifiable in this audit

Because the sandbox was read-only and network use was prohibited, this audit could not verify:

- Whether all migrations are actually applied to the current cloud project.
- Current production values of `DIAL_MODE`, `GLOBAL_CAP`, `DIALING_ENABLED`, or provider IDs.
- Whether B5 DEV_TEST rows have been archived or remain in the production pharmacy table.
- The current verified real-pharmacy seed, its opening hours, or today’s holiday overrides.
- Actual Supabase RLS/realtime behavior between two live anonymous sessions.
- Whether the deployed code exactly matches `da37a75`.
- ElevenLabs/Twilio’s live 30-second ring setting, five-minute limit, voicemail detection, end-call tool, or DTMF configuration.
- Whether every real ElevenLabs 4xx is a definite non-call rather than an ambiguous outcome.
- Vercel’s deployed `after()` execution duration and failure behavior.
- External DB, ElevenLabs, Twilio, or OpenAI logs cited by the 3.5/3.6 evidence files.
- The claimed real-LLM transcript/verdict pairs; `scripts/replay-transcripts.mjs` was inspected but not executed.
- Runtime behavior of the 1 MB webhook cap under chunked or platform-rejected oversized requests.
- Any real phone behavior. No network request or call was made.