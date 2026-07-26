import crypto from "node:crypto";

/**
 * Internal-route guard (4.2/4.4). Fail closed: an unset, short, or
 * mismatched INTERNAL_SECRET means 401 — a misconfigured deploy must never
 * expose the watchdog. Timing-safe comparison, same discipline as the
 * webhook HMAC check.
 */
export function isAuthorizedInternal(
  provided: string | null,
  expected: string | undefined,
): boolean {
  if (!expected || expected.length < 16) return false; // unset/weak secret = closed
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
