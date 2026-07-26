The webhook does not uphold its critical always-200 and raw-evidence guarantees on several concrete failure and input paths, while the schema's append-only and least-privilege hardening remains incomplete. Phase 0 is not yet a safe foundation for Phase 3 until these gaps—especially the P1 escape path—are fixed.

Full review comments:

- [P1] Guarantee a 200 from every handler path — /Users/marvin/hackathon/app/api/webhooks/elevenlabs/route.ts:43-44
  Because `POST` has no outer catch, a rejected body read, missing/malformed Supabase configuration, or a valid signed JSON `null` payload that reaches `p.type` can escape as a 500. Repeated deliveries in any of these scenarios count toward ElevenLabs' auto-disable; wrap the entire handler in a final catch that logs and returns 200.

- [P2] Persist every verified body before parsing it — /Users/marvin/hackathon/app/api/webhooks/elevenlabs/route.ts:59-63
  A validly signed malformed JSON body is acknowledged with 200 but never recorded, permanently losing the only evidence and violating the append-raw invariant. Even successful parsing stores normalized JSONB rather than the signed body; add a `raw_body` text/bytea field and persist every verified request before best-effort parsing.

- [P2] Cap the body before buffering it — /Users/marvin/hackathon/app/api/webhooks/elevenlabs/route.ts:43-44
  Any unauthenticated caller can make the route fully buffer a body before HMAC verification, with no declared-length or streamed limit. Repeated requests near the platform limit can consume memory and execution time or produce 5xx responses; check `Content-Length` and enforce a hard cap while streaming, still returning 200 when exceeded.

- [P2] Revoke inherited privileges before granting client reads — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:210-214
  On Supabase databases with bootstrap privileges already present, including the local schema snapshot, these additive grants leave `TRUNCATE`, `TRIGGER`, `REFERENCES`, and `MAINTAIN` privileges on `anon` and `authenticated`; RLS does not protect `TRUNCATE`. Revoke all inherited table/default privileges from those roles first, then grant only the listed SELECT permissions.

- [P2] Block deletion of transcript-bearing calls — /Users/marvin/hackathon/supabase/migrations/20260726000001_init.sql:133-135
  When a service-role command deletes a `calls` row after its transcript is populated, this UPDATE-only trigger never runs and the raw transcript disappears despite the append-only evidence requirement. Add a `BEFORE DELETE` guard, or remove the applicable DELETE privilege, and cover deletion in the constraint proof.