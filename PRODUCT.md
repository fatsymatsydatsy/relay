# PRODUCT.md — MedFind

_Inferred from `medfind-prd.md` + the 2026-07-25 architecture discussion; assumptions labeled. Owner: Marvin (solo builder, directing Claude Code)._

## What it is

- AI pharmacy stock finder for UK medication shortages. Patient enters medication (exact strength/form) + postcode + radius; an ElevenLabs voice agent really phones every open pharmacy in radius; results stream back live, ranked.
- One-liner: **"We make the phone calls so you don't have to."**
- 48-hour build for the Juno × Anthropic "Build the Future of Healthcare" hackathon.

## Audience & scene

- Patients whose medication is out of stock (shortage meds: Creon, Estradot, Ramipril…). Stressed, on a phone, mid-errand. Anonymous — no accounts.
- Secondary: hackathon judges watching a live demo (12–2pm window).

## Mechanism (the unique thing)

- There is no live UK pharmacy stock database anywhere; phone calls are the only source of truth. The product industrializes phone calls: queue → concurrent AI calls → transcript → structured verdict → live ranked scoreboard.

## Non-negotiables (from PRD)

- Agent discloses it's automated when asked; never impersonates patient/clinician.
- No patient-identifying data; postcode only.
- Verdicts timestamped ("confirmed by phone at 14:32"); never presented as reservations.
- Unanswered/unverified calls never render as stock verdicts.
- Call etiquette is existential: pharmacies must not hate these calls (≤1 call per number per hour globally, never call closed pharmacies, 5-min call budget, one follow-up max).
- Required disclaimer: stock checker, not medical advice; 999/111 signposting.

## Fixed stack

- Next.js App Router on Vercel · Supabase (Postgres + realtime) · ElevenLabs agents + Twilio (Creator plan, 10 concurrent — confirmed) · OpenAI API for transcript→schema (hackathon-issued credits; changed 2026-07-25 from the PRD's "Claude" — Anthropic's sponsor credit is Claude Code usage, which builds the project). No other third-party services without checking (postcodes.io pending sign-off).

## Out of scope

- Prescriptions/EPS, payments, auth, automated holds, medical advice, native apps.

## Brand commitments

- NHS-adjacent trustworthy, honesty-first: timestamps over promises, "couldn't check" over silence. (Assumption: NHS-blue + UK pharmacy-green visual family, established by the architecture doc artifacts 2026-07-25.)
