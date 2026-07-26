Phase 0 cannot access Supabase through its service or client roles, and the database accepts unconfirmed stock payloads. The transcript column grant and current cap/phone indexes are otherwise appropriate, and no secrets were found anywhere in the two-commit history.

Full review comments:

- [P1][High] Grant explicit Data API privileges — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:153-153
  Because `auto_expose_new_tables` is unset, policies alone give neither `service_role` CRUD access nor client SELECT access to `pharmacies`, `medications`, and `searches`. Consequently `serviceClient()` receives `permission denied` during the Phase 0.3 count, later commands cannot write, and client reads fail before RLS is evaluated; add explicit least-privilege table and identity-sequence grants.

- [P1][High] Require confirmation for every stock verdict payload — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:89-93
  The `rank_bucket is null` and `rank_bucket = 4` branches accept a non-null in-stock verdict with `location_confirmed = 'no'`; because clients are granted the `verdict` column, that unverified result can be exposed despite the core honesty invariant. Independently require confirmed location and completed/verdict status whenever stock data is present, prohibit stock statuses in bucket 4, and add proof cases for both bypasses.

- [P2][Med] Model the dial-log reservation outcome — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:117-123
  Phase 3.2 requires a definite ElevenLabs rejection to free the number while an ambiguous timeout still blocks it, but this table records only a phone and timestamp. Since dispatch must reserve before the outbound request to prevent races, it can currently only block both outcomes or delete definite failures and lose audit history; add a lifecycle/counts-for-cooldown state and make the phone-time index cover only blocking states.

- [P2][Med] Make raw call data append-only — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:74-74
  Once the intended service-role writer receives UPDATE access, a duplicate or buggy webhook can replace an existing `calls.transcript`; the raw log tables likewise have no update/delete guard. This destroys the evidence needed for rerunnable extraction, so allow only `NULL` to first-value transcript transitions and restrict `call_events`/`dial_log` to INSERT and SELECT, or enforce equivalent immutability triggers.

- [P2][Med] Fail the proof process on the first SQL error — /Users/marvin/hackathon/scripts/prove-constraints.sql:2-2
  If a constraint is removed and a forbidden insert succeeds, the explicit `raise exception` fails the `DO` statement, but default `psql` continues to `ROLLBACK` and exits successfully. A machine gate checking process status can therefore pass a regression; add `\set ON_ERROR_STOP on` or invoke `psql -v ON_ERROR_STOP=1`.

- [P2][Med] Enforce one canonical representation for dial numbers — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:30-30
  Despite the E.164 comment, values with spaces, `0044`, or other representations are accepted. If two pharmacy records contain variants of the same real number, the `(phone, dialed_at)` lookup treats them as distinct and dispatch can dial that number twice within an hour; normalize before insertion and add E.164 checks to pharmacy, dial-snapshot, and dial-log number columns.

- [P2][Med] Point database reset at the approved seed directory — /Users/marvin/hackathon/supabase/config.toml:71-71
  The repository tree and Phase 1 plan place seeds under `supabase/seed/`, but reset loads only `supabase/seed.sql`. A later `supabase/seed/fake-data.sql` will be silently skipped by `npm run db:reset`; change this to a directory glob such as `./seed/*.sql`, or consistently use the single configured file.

- [P3][Low] Reject negative extraction-attempt counts — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:79-79
  `extraction_attempts <= 3` accepts negative values. If a replay, repair, or command bug writes `-1`, retry logic that increments until three can perform extra model calls while the constraint proof remains green; use `check (extraction_attempts between 0 and 3)` and add a negative-value proof case.

- [P3][Low] Declare Node 22 as the minimum runtime — /Users/marvin/hackathon/package.json:15-15
  The lockfile resolves `@supabase/supabase-js` 2.110.8, which requires Node 22 or newer, but the package declares no engine. A Node 20 checkout or Vercel project can install with only a warning and then run unsupported code; add `engines.node: ">=22"` and optionally an `.nvmrc`.