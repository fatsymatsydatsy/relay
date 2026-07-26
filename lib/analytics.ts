import posthog from "posthog-js";

const ENABLED = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

/**
 * Health-search data (medication, dose, postcode, email, free text) must NEVER
 * enter analytics (privacy rule in PRODUCT.md; codex review P1-2). Only keys
 * on this allowlist survive; everything else is stripped before capture.
 */
const SAFE_PROPS = new Set(["variant", "known_medication", "stage"]);

/** Pure so the redaction is unit-testable (tests/analytics-allowlist.test.ts). */
export function sanitizeProps(
  properties?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!properties) return undefined;
  const safe = Object.fromEntries(
    Object.entries(properties).filter(([key]) => SAFE_PROPS.has(key)),
  );
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** Capture a product event, no-op when PostHog isn't configured. */
export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (ENABLED) posthog.capture(event, sanitizeProps(properties));
}
