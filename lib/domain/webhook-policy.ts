/**
 * Webhook interpretation policy (3.7, audit P1-7 minimal fix).
 *
 * The raw-event insert is dedupe layer 1 (unique dedupe_key). Interpretation
 * used to run ONLY when that insert was new — at-most-once: if the post-200
 * `after()` work died, the provider's redelivery hit the unique index (23505)
 * and was deliberately never interpreted, leaving the call `dialing` forever.
 *
 * Interpretation is idempotent by construction (layer 2: every transition is
 * `UPDATE … WHERE status = expected` — webhook.idempotent), so re-running it
 * on a duplicate is free. Policy: interpret on first delivery AND on 23505
 * duplicates; any OTHER insert error means the raw event was NOT persisted —
 * store-raw-first is the evidence rule, so nothing is interpreted and the
 * error is logged for the 4.2 watchdog's durable outbox to own properly.
 */
export function shouldScheduleInterpretation(
  insertError: { code?: string } | null,
): boolean {
  return !insertError || insertError.code === "23505";
}
