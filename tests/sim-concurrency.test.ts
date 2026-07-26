import { describe, expect, it } from "vitest";
import { SCRIPT, maxConcurrent } from "@/lib/search/simulated";
import { PHARMACIES } from "@/lib/pharmacies";

// The demo must never SHOW behavior production forbids: ≤3 calls in flight
// per search is a hard dispatch invariant (CLAUDE.md). The original vendored
// scripts ran 5 overlapping calls (26 Jul review, P2-3).

describe("simulated call scripts respect the ≤3 in-flight cap", () => {
  it("/search demo engine peaks at 3 concurrent calls", () => {
    expect(maxConcurrent(SCRIPT)).toBeLessThanOrEqual(3);
  });

  it("landing-page RelayPanel animation peaks at 3 concurrent calls", () => {
    expect(maxConcurrent(PHARMACIES)).toBeLessThanOrEqual(3);
  });

  it("maxConcurrent counts overlap correctly", () => {
    expect(
      maxConcurrent([
        { startAt: 0, dialingMs: 100, askingMs: 100 },
        { startAt: 50, dialingMs: 100, askingMs: 100 },
        { startAt: 300, dialingMs: 10, askingMs: 10 },
      ]),
    ).toBe(2);
    // a call starting exactly when another ends reuses the freed line
    expect(
      maxConcurrent([
        { startAt: 0, dialingMs: 50, askingMs: 50 },
        { startAt: 100, dialingMs: 50, askingMs: 50 },
      ]),
    ).toBe(1);
  });
});
