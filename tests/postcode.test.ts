import { describe, expect, it } from "vitest";
import { escapeHtml, normalizePostcode } from "@/lib/search/geocode";

// Every postcode entering the app goes through normalizePostcode; the map's
// Leaflet DivIcon label additionally goes through escapeHtml (innerHTML sink).
// Both guards came out of the 26 Jul UI-merge review (P1-4, P2-1).

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

describe("escapeHtml", () => {
  it("neutralizes markup so DivIcon innerHTML cannot execute it", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml("Tom & Jerry's <b>")).toBe(
      "Tom &amp; Jerry&#39;s &lt;b&gt;",
    );
    expect(escapeHtml("B5 4BU")).toBe("B5 4BU");
  });
});
