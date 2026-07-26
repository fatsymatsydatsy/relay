# Relay — CLAUDE.md

AI pharmacy stock finder (48h hackathon, submission 12:00 26 Jul 2026: GitHub repo + ≤60s demo video).
One-liner: patient enters med + postcode → an ElevenLabs voice agent really phones open pharmacies → verdicts stream live, ranked.

## Read these first, in order (fresh session? this list IS your context)

1. **[build-steps.md](build-steps.md)** — THE living state file: every phase/step/sub-step, its acceptance criteria, its status. Where we are = what it says. Find the `[~]`; that's the work.
2. **[docs/architecture.md](docs/architecture.md)** — how the system works: golden rule, commands, state machine v3, event model, integration endpoints, failure table.
3. **[docs/operations.md](docs/operations.md)** — live URLs, project refs, local test stack quirks, scripts, session ritual.
4. [PRODUCT.md](PRODUCT.md) — product truth, non-negotiables. [CONTEXT.md](CONTEXT.md) — glossary. [DESIGN.md](DESIGN.md) — visual tokens.
5. [pharmacy-call-agent-script.md](pharmacy-call-agent-script.md) — the agent's authoritative behavior (approved v1.2).
6. [docs/runbook.md](docs/runbook.md) — submission-day schedule, video shot list, role-play scripts, UI contract for the teammate.

(Rendered artifact copies for Marvin's viewing only — may not be fetchable in-session; the repo files above are canonical: architecture https://claude.ai/code/artifact/f0a43665-e165-42a2-a329-b0ee9ea793cd · build plan https://claude.ai/code/artifact/245e67ed-4ad4-4e98-bc47-e97ef55700a2)

## Status protocol (non-negotiable, from how-we-work)

- **Before starting** any step or sub-step: mark it `[~]` (in progress) in build-steps.md. One `[~]` per track at a time.
- **When finished:**
  - 🤖 machine-gated → run its acceptance criteria; green → mark `[x]` and commit.
  - 🧑 human-gated → make machine-checkable parts green first, then mark `[?]` (pending Marvin's approval) and hand off ONE focused manual test ("here's exactly what to look at"). Only Marvin's approval moves `[?]` → `[x]`.
- Never conflate "built" with "done." Never start the next step in a track before the previous is `[x]`.
- Commit per step, message prefixed with the step id (e.g. `0.4: tracer bullet — webhook round-trip`).
- If a criterion turns out wrong, change it in build-steps.md FIRST (say so), then build.

## The golden rule (architecture)

Postgres is the single source of truth · small commands are the only writers · the UI is a projection.
One command = one file in `lib/commands/`. When something breaks, the stuck row's status names the guilty file.

## Invariants (never violate, never bypass in code)

- ≤3 calls in flight per search · ≤8 global (`GLOBAL_CAP`) · one dial per phone number per hour · never call a closed pharmacy (Europe/London time) — ALL enforced inside dispatch's single advisory-locked claim function, nowhere else.
- Unanswered/unverified is NEVER a stock verdict (rank bucket 4, type-enforced).
- Webhooks: verify HMAC, always 200, idempotent transitions (`UPDATE … WHERE status = expected`), correlate by our `call_ref`, post-200 work in `waitUntil()`.
- Store raw (transcripts, payloads) append-only; derive verdicts; extraction is re-runnable.
- DEV_TEST reroutes dialing to team phones via `resolveDialNumber()` ONLY — politeness rules are never switched off; test data (fake 24/7 pharmacies) does the work.
- No PII: postcode only. Client never receives raw transcripts. Disclaimer always visible.

## Directory map

`app/` routes only (UI colocated) · `components/` + `lib/search/` UI vendored from the teammate's relay repo (Phase 1 fold-in; `lib/search/types.ts` is the UI↔backend seam) · `lib/commands/` one file per command · `lib/domain/` pure logic, no I/O, unit-tested · `lib/integrations/` elevenlabs/openai/geocode/supabase (+ `supabase-browser.ts` anon client) · `lib/prompts/` extraction prompt · `supabase/migrations` + `supabase/seed` · `scripts/` run-by-hand (seed, replay-transcripts) · `tests/` · `docs/` (+ `docs/review/` adversarial reports) · `evidence/` real-run call logs.

## Conventions

- Machine-green before any human handoff (typecheck, tests, build).
- One manual test per handoff, one behavior, with "what to look for."
- Turn every past bug into a named test (see build-steps.md "Designed-out bugs").
- Secrets only in `.env.local` (gitignored); `.env.example` names every key.
- Glossary: **bench** = ranked replacement pharmacies beyond the first 6 · **bucket** = rank tier 1–4 · **DEV_TEST/REAL** = dial-routing mode · **throw-out step** = the open-now + stays-open-1h filter before scoring.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/` (bugs/QA findings + specs; build-steps.md stays the build tracker). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
