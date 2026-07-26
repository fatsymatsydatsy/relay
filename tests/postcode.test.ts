import { describe, expect, it } from "vitest";
import { normalizePostcode } from "@/lib/search/geocode";

// Every postcode entering the app goes through normalizePostcode before it is
// used anywhere (26 Jul UI-merge review, P1-4/P2-1).

describe("normalizePostcode", () => {
  it("canonicalizes valid postcodes with or without spaces", () => {
    expect(normalizePostcode("B5 4BU")).toBe("B5 4BU");
    expect(normalizePostcode("b54bu")).toBe("B5 4BU");
    expect(normalizePostcode("  sw1a1aa ")).toBe("SW1A 1AA");
    expect(normalizePostcode("EC1A 1BB")).toBe("EC1A 1BB");
    expect(normalizePostcode("m1 1ae")).toBe("M1 1AE");
  });

  it("rejects everything that is not a plausible UK postcode", () => {
    expect(normalizePostcode("")).toBeNull();
    expect(normalizePostcode("not a postcode")).toBeNull();
    expect(normalizePostcode("12345")).toBeNull();
    expect(normalizePostcode("SW1A")).toBeNull(); // outward code alone
    expect(normalizePostcode("SW1A 1AAA")).toBeNull();
    expect(normalizePostcode("<img src=x>")).toBeNull();
    expect(normalizePostcode("B5 4BU'--")).toBeNull();
  });
});
