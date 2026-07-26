# CONTEXT.md — MedFind ubiquitous language

One shared vocabulary for conversation, code, UI, and commits. When communication stalls, suspect a
term mismatch first, pin the term here.

## Glossary

| Term | Means | Don't confuse with |
|---|---|---|
| **search** | One patient request: med + dosage + quantity + postcode + radius. A draining queue of calls, not a single pass. | A database query |
| **call** | One row in `calls`: one attempt to reach one pharmacy for one search. Has exactly one status at all times. | A phone call in progress (that's the `dialing`/live part of a call's life) |
| **verdict** | The structured outcome extracted from a transcript (stock, amount, orderable, ETA). Only exists when a human at the right branch answered. | A raw transcript · a bucket |
| **bucket** | Rank tier 1–4: in stock → orderable by soonest ETA → no stock → couldn't reach/verify. Bucket 4 is never a stock verdict. | The verdict itself (bucket is derived from it) |
| **bench** | The ranked open pharmacies beyond the first 6, promoted one at a time when a call dies. | A retry (we never redial; bench = different pharmacy) |
| **throw-out step** | The pass/fail filter before scoring: closed now, or closing within 1h → never called. | The scorer (that ranks survivors) |
| **portfolio pick** | Scored, constrained selection: ≤2 per chain, ≥2 independents, mix of supply chains. | Nearest-first |
| **dial_log** | Append-only record of dial attempts per phone number; enforces the 1-call-per-number-per-hour rule and doubles as the verdict cache key. | `call_events` (raw webhook payloads) |
| **tracer bullet** | Phase 0's end-to-end proof call through Vercel↔ElevenLabs↔Twilio↔Supabase with zero product logic. | The dress rehearsal (step 3.6) |
| **DEV_TEST / REAL** | Dial-routing mode. DEV_TEST sends every dial to team phones via `resolveDialNumber()`; politeness rules stay on — fake 24/7 pharmacies in seed data do the work. | A rules bypass (none exists) |
| **watchdog** | The per-minute pg_cron sweep that only notices silence (lost webhooks, dead-quiet timeouts). It acting = logged anomaly. | The dispatcher (event-driven) |
| **settle** | Marking a search complete at queue-drain or 20 min; expires leftover queued children. | Cancelling in-flight calls (they finish; data stays honest) |
| **branch check** | The agent's greeting question ("Is this the X pharmacy on Y street?"). The human's answer is the only accepted proof of location. | Trusting IVR routing |

## Where decisions live

- Locked build decisions: `build-steps.md` §Locked decisions (do not re-litigate mid-build).
- Architecture + rationale: the rendered doc — https://claude.ai/code/artifact/f0a43665-e165-42a2-a329-b0ee9ea793cd (source exported to `docs/architecture.md` at repo finalize).
- Agent behavior: `pharmacy-call-agent-script.md` (approved v1.2).
- Adversarial-review findings that shaped the design: `docs/review/` (populated at repo finalize).
- `docs/adr/` starts empty; add an ADR only for new hard-to-reverse decisions from here on.
