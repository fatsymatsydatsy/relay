/**
 * Dial resolution (2.4) — the ONLY place a dialable number comes from.
 *
 * DEV_TEST reroutes every dial to a team phone (deterministically spread by
 * ODS code so different fake pharmacies ring different teammates). Politeness
 * rules are NEVER switched off — test DATA (fake 24/7 pharmacies) does that
 * work. REAL refuses anything unverified or test-sourced: the claim function
 * (3.2) snapshots this result onto the row before dialing.
 */

export type DialMode = "DEV_TEST" | "REAL";

export interface DialTarget {
  ods: string;
  phone: string;
  verified: boolean;
  source: string; // 'manual' | 'nhs_api' | 'dev_test'
}

export type DialResolution =
  | { ok: true; mode: DialMode; intendedNumber: string; resolvedNumber: string }
  | { ok: false; reason: "unverified" | "test_pharmacy_in_real" | "no_dev_numbers" | "bad_number" };

const E164 = /^\+[1-9][0-9]{6,14}$/;

export function resolveDialNumber(
  pharmacy: DialTarget,
  mode: DialMode,
  devTestNumbers: readonly string[],
): DialResolution {
  if (!E164.test(pharmacy.phone)) {
    return { ok: false, reason: "bad_number" };
  }

  if (mode === "DEV_TEST") {
    const valid = devTestNumbers.filter((n) => E164.test(n));
    if (valid.length === 0) return { ok: false, reason: "no_dev_numbers" };
    // stable spread: the same fake pharmacy always rings the same teammate
    const idx = hashOds(pharmacy.ods) % valid.length;
    return {
      ok: true,
      mode,
      intendedNumber: pharmacy.phone,
      resolvedNumber: valid[idx],
    };
  }

  // REAL: only verified, non-test pharmacies may ever be dialed.
  if (pharmacy.source === "dev_test") {
    return { ok: false, reason: "test_pharmacy_in_real" };
  }
  if (!pharmacy.verified) {
    return { ok: false, reason: "unverified" };
  }
  return {
    ok: true,
    mode,
    intendedNumber: pharmacy.phone,
    resolvedNumber: pharmacy.phone,
  };
}

function hashOds(ods: string): number {
  let h = 0;
  for (let i = 0; i < ods.length; i++) {
    h = (h * 31 + ods.charCodeAt(i)) >>> 0;
  }
  return h;
}
