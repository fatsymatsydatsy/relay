# Runbook — submission day (SUNDAY 26 Jul 2026, deadline 12:00)

*(Weekday corrected 26 Jul ~07:30 — this file said "Sat". **It's Sunday**: most independents are closed, supermarket pharmacies typically run ~10:00–16:00. The seeder's per-pharmacy TODAY-hours table is the source of truth for what can actually dial, and the verification run may need to slide toward the first Sunday openings.)*

Submission = GitHub repo + demo video ≤ 60 seconds. Marking: Idea /10 · Design /10 (must not look AI-generated) · Code quality /10 (reviews in `docs/review/` are the exhibit) · Demo /10 (1-min cap) + bonus real users (honest recruitment only) + bonus sponsor tools (Claude Code built it; OpenAI credits run extraction).

## Morning schedule (SUNDAY hours — check the seeder's dialable column)

1. **08:00** — seed real B5 pharmacies from the NHS API (5.0): `npm run seed:nhs -- --postcode "B5 4BU" --env int` (key in `.env.local` as `NHS_DOHS_API_KEY`; no key yet → hand-fill `tests/fixtures/nhs-organisations-sample.json`-shaped JSON from nhs.uk and use `--from-file`). Rows land `verified=false` — nothing can dial yet. Read the printed TODAY column: pick ≥8 with real Sunday hours.
2. **08:15** — site up, `DIALING_ENABLED` still off for REAL, last night's test data archived.
3. **08:30** — teammates spot-call the demo pharmacies ("open today? right branch?") → flip with `npm run seed:nhs -- --verify ODS1,ODS2,…`.
4. **09:00** — flip `DIAL_MODE=REAL` (flip auto-cancels non-terminal rows) → ONE verification search, everyone watching → archive logs to `evidence/`. ⚠️ Sunday: if the seeder shows nothing DIALABLE before ~10:00, slide this to the first real openings and compress the politeness window against the video run — the disjoint-set backup (below) becomes plan A for the video.
5. **09:15–10:15** — ⚠️ **THE 65-MINUTE RULE**: do NOT touch the same pharmacies again — the 1-hour politeness lock + cache would make the video run queue zero live calls (looks faked). Use the window for README + video B-roll.
6. **10:20** — **the video run**: fresh search, record. Backup = disjoint pharmacy set (adjacent postcode).
7. **10:45** — real-users bonus (stretch): 2–3 family/friends run a search on their phones; screenshot + one honest line on recruitment.
8. **11:00** — repo final push, README check, cut video to ≤60s, upload. **11:45 submit.**

## 60-second video shot list

0–8s problem ("no stock database exists; we phoned 4 pharmacies, one had 2 boxes") · 8–18s type Creon 25,000 + postcode → Search → queue fills · 18–40s **money shot**: phone on speaker talking to a real pharmacist while the board flips a verdict live · 40–52s ranked board with timestamp + honest "couldn't reach" rows · 52–60s "We make the calls so you don't have to" + repo URL.

## If X goes wrong

- Real calls impossible → record the DEV_TEST dress rehearsal, narrated honestly ("test mode, real flow").
- No answers at 10:20 → the 09:00 verification run's logged results are real prior evidence; narrate honestly.
- Anything stuck → `select status, count(*) from calls group by 1`, then the failure table in docs/architecture.md.

## Role-play script (DEV_TEST calls — teammates play pharmacist)

| Scenario | Say | Must land as |
|---|---|---|
| Happy path | "Yes this is [pharmacy]… let me check… [60–90s silence] … we have 2 boxes" | Bucket 1, qty 2, survives silence |
| Orderable | "No stock, can order — Thursday" | Bucket 2, ETA normalized |
| Plain no | "None, national shortage" | Bucket 3, shortage flag |
| Wrong branch | "No love, this is the Mill Road branch" | Bucket 4 "couldn't verify branch" |
| Voicemail | let it ring out | no-answer → bench replaces |
| Robot check | "Am I talking to a machine?" | truthful disclosure, never denies |

## UI contract (teammate)

UI reads two live feeds (RLS scopes to the anonymous session's own searches): a realtime subscription on the OWN `searches` row — which a DB trigger bumps on every `calls` change — plus a refetch of the column-granted `calls` rows per tick. *(Direct realtime on `calls` is impossible by design: realtime needs table-level SELECT, and `calls` keeps transcript/dial numbers behind column grants — see the board_tick migration.)* Per call: pharmacy name/address/distance · status · rank bucket 1–4 · verdict jsonb · timestamps. Sort: bucket, then ETA/distance. States to design: queued · dialing · 3 verdict kinds · couldn't-reach · expired. The two gated hard rules (build-steps 1.4 checks exactly these; renumbered in the 26 Jul Phase-1 restructure): disclaimer always visible ("Relay checks pharmacy stock availability. It does not provide medical advice… 999/111") · bucket 4 must NEVER look like a stock verdict. Also required: partial stock reads "in stock — 1 box (you need 2)"; raw transcripts never reach the client (enforced by column grants, not by the UI). Design tokens: DESIGN.md.
