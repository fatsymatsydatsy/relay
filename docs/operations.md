# Operations — the facts a fresh session needs

## Live surfaces

- **Production:** https://medfind-three.vercel.app (Vercel project `medfind`, deploy: `vercel deploy --prod --yes`)
- **Cloud Supabase:** project ref `xmktnizljybwptxnmtmq` (linked; `supabase db push` applies new migrations)
- **Webhook endpoint:** `https://medfind-three.vercel.app/api/webhooks/elevenlabs` — registered in ElevenLabs workspace settings, HMAC secret in env
- **ElevenLabs:** agent `<ELEVENLABS_AGENT_ID in .env.local>` ("Test" — replaced by call-script config in Phase 3), phone `<ELEVENLABS_PHONE_NUMBER_ID in .env.local>` = **+44 20 4652 2842** (London caller ID, Twilio)

## Environment

All secrets in `.env.local` (gitignored, present on Marvin's machine); every key named in `.env.example`. Production env mirrors it via `vercel env` (already set). `DIAL_MODE=DEV_TEST` routes all dials to team phones (`DEV_TEST_PHONE_NUMBERS`, three numbers, E.164).

## Local test stack (destructive tests run HERE, never against cloud)

- Supabase local: **ports moved to 555xx** (avoid clashing with Marvin's other project): API `http://127.0.0.1:55521`, DB `postgresql://postgres:postgres@127.0.0.1:55522/postgres` (= `TEST_DATABASE_URL` in `.env.local`)
- Analytics container **disabled** in `supabase/config.toml` (colima incompatibility — do not re-enable)
- Docker runs via **colima** (`colima start` if the daemon is down)
- Reset + verify: `supabase db reset` then
  `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/prove-constraints.sql`
  → must end **"ALL 13 FORBIDDEN STATES REJECTED"**

## Scripts

- `scripts/tracer-call.mjs [+44…]` — fires ONE real outbound call (defaults to first team number). It rings a real phone: only with Marvin's go.
- `scripts/prove-constraints.sql` — the schema's 13-forbidden-states proof (see above).

## Cost/politeness guardrails (never bypass in code)

≤3 calls in flight per search · ≤8 global · one dial per number per hour (`dial_log`, outcomes reserved/connected/freed) · never call closed pharmacies (Europe/London!) · voicemail pickup is billed — closed-hours calls cost real money.

## Session ritual

1. Read `build-steps.md` → find the `[~]` / next `[ ]` → that's the work.
2. Statuses change there FIRST (protocol in CLAUDE.md).
3. Commit per step, step id prefixed.
