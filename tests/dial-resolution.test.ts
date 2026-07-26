import { describe, expect, it } from "vitest";
import { resolveDialNumber, type DialTarget } from "@/lib/domain/dial-resolution";

const TEAM = ["+447700900101", "+447700900102", "+447700900103"];

function pharmacy(overrides: Partial<DialTarget> = {}): DialTarget {
  return {
    ods: "FAKE01",
    phone: "+441214960001",
    verified: false,
    source: "dev_test",
    ...overrides,
  };
}

describe("DEV_TEST mode", () => {
  it("always resolves to a team number, never the pharmacy's", () => {
    const r = resolveDialNumber(pharmacy(), "DEV_TEST", TEAM);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(TEAM).toContain(r.resolvedNumber);
      expect(r.resolvedNumber).not.toBe(r.intendedNumber);
      expect(r.intendedNumber).toBe("+441214960001"); // snapshot keeps the truth
    }
  });

  it("is deterministic per pharmacy and spreads across the team", () => {
    const a1 = resolveDialNumber(pharmacy({ ods: "FAKE01" }), "DEV_TEST", TEAM);
    const a2 = resolveDialNumber(pharmacy({ ods: "FAKE01" }), "DEV_TEST", TEAM);
    expect(a1).toEqual(a2);

    const resolved = new Set(
      ["FAKE01", "FAKE02", "FAKE03", "FAKE04", "FAKE05", "FAKE06"].map((ods) => {
        const r = resolveDialNumber(pharmacy({ ods }), "DEV_TEST", TEAM);
        return r.ok ? r.resolvedNumber : "";
      }),
    );
    expect(resolved.size).toBeGreaterThan(1); // not everyone rings one phone
  });

  it("refuses when no valid team numbers are configured", () => {
    expect(resolveDialNumber(pharmacy(), "DEV_TEST", [])).toEqual({
      ok: false,
      reason: "no_dev_numbers",
    });
    expect(resolveDialNumber(pharmacy(), "DEV_TEST", ["07700 900101"])).toEqual({
      ok: false,
      reason: "no_dev_numbers", // non-E.164 entries don't count
    });
  });
});

describe("REAL mode", () => {
  it("dials a verified real pharmacy's own number", () => {
    const r = resolveDialNumber(
      pharmacy({ verified: true, source: "manual" }),
      "REAL",
      TEAM,
    );
    expect(r).toEqual({
      ok: true,
      mode: "REAL",
      intendedNumber: "+441214960001",
      resolvedNumber: "+441214960001",
    });
  });

  it("refuses unverified pharmacies", () => {
    expect(
      resolveDialNumber(pharmacy({ verified: false, source: "manual" }), "REAL", TEAM),
    ).toEqual({ ok: false, reason: "unverified" });
  });

  it("refuses dev_test pharmacies even if marked verified", () => {
    expect(
      resolveDialNumber(pharmacy({ verified: true, source: "dev_test" }), "REAL", TEAM),
    ).toEqual({ ok: false, reason: "test_pharmacy_in_real" });
  });
});

describe("both modes", () => {
  it("refuses malformed pharmacy numbers outright", () => {
    expect(
      resolveDialNumber(pharmacy({ phone: "0121 496 0001" }), "DEV_TEST", TEAM),
    ).toEqual({ ok: false, reason: "bad_number" });
    expect(
      resolveDialNumber(
        pharmacy({ phone: "not-a-number", verified: true, source: "manual" }),
        "REAL",
        TEAM,
      ),
    ).toEqual({ ok: false, reason: "bad_number" });
  });
});
