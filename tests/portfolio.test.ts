import { describe, expect, it } from "vitest";
import { buildPortfolio, type Candidate } from "@/lib/domain/portfolio";
import type { OpeningHours } from "@/lib/domain/opening-hours";

// Mon 26 Jan 2026 10:00 UTC = 10:00 London (GMT — wall clock == UTC).
const NOW = new Date("2026-01-26T10:00:00Z");

const OPEN_ALL_DAY: OpeningHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [["08:00", "20:00"]]]),
);
const CLOSES_SOON: OpeningHours = { mon: [["08:00", "10:40"]] };
const CLOSED_TODAY: OpeningHours = { tue: [["09:00", "18:00"]] };

function candidate(overrides: Partial<Candidate> & { ods: string }): Candidate {
  return {
    distanceKm: 1,
    hours: OPEN_ALL_DAY,
    ownershipGroup: "independent",
    isSupermarket: false,
    history: { calls: 0, verdicts: 0 },
    answeredBefore: false,
    ...overrides,
  };
}

describe("throw-out step", () => {
  it("closed and closing-within-the-hour are always excluded", () => {
    const { targets, bench, thrownOut } = buildPortfolio({
      candidates: [
        candidate({ ods: "A" }),
        candidate({ ods: "B", hours: CLOSES_SOON }),
        candidate({ ods: "C", hours: CLOSED_TODAY }),
      ],
      now: NOW,
      radiusKm: 5,
    });
    expect(targets.map((t) => t.ods)).toEqual(["A"]);
    expect(bench).toEqual([]);
    expect(thrownOut).toEqual([
      { ods: "B", reason: "closing_soon" },
      { ods: "C", reason: "closed" },
    ]);
  });
});

describe("constrained pick", () => {
  it("never more than 2 per chain, even when the chain scores best", () => {
    const { targets } = buildPortfolio({
      candidates: [
        // chain members closest → highest proximity scores
        candidate({ ods: "B1", ownershipGroup: "boots", distanceKm: 0.1 }),
        candidate({ ods: "B2", ownershipGroup: "boots", distanceKm: 0.2 }),
        candidate({ ods: "B3", ownershipGroup: "boots", distanceKm: 0.3 }),
        candidate({ ods: "B4", ownershipGroup: "boots", distanceKm: 0.4 }),
        candidate({ ods: "I1", distanceKm: 3 }),
        candidate({ ods: "I2", distanceKm: 4 }),
      ],
      now: NOW,
      radiusKm: 5,
      targetCount: 4,
    });
    const boots = targets.filter((t) => t.ownershipGroup === "boots");
    expect(boots).toHaveLength(2);
    expect(targets.map((t) => t.ods).sort()).toEqual(["B1", "B2", "I1", "I2"]);
  });

  it("independents are NOT chain-capped", () => {
    const { targets } = buildPortfolio({
      candidates: [1, 2, 3, 4, 5].map((n) =>
        candidate({ ods: `I${n}`, distanceKm: n }),
      ),
      now: NOW,
      radiusKm: 10,
      targetCount: 5,
    });
    expect(targets).toHaveLength(5);
  });

  it("guarantees ≥2 independents when available", () => {
    const { targets } = buildPortfolio({
      candidates: [
        candidate({ ods: "B1", ownershipGroup: "boots", distanceKm: 0.1 }),
        candidate({ ods: "B2", ownershipGroup: "boots", distanceKm: 0.2 }),
        candidate({ ods: "L1", ownershipGroup: "lloyds", distanceKm: 0.3 }),
        candidate({ ods: "L2", ownershipGroup: "lloyds", distanceKm: 0.4 }),
        candidate({ ods: "I1", distanceKm: 4.5 }),
        candidate({ ods: "I2", distanceKm: 4.8 }),
      ],
      now: NOW,
      radiusKm: 5,
      targetCount: 4,
    });
    const independents = targets.filter((t) => t.ownershipGroup === "independent");
    expect(independents.length).toBeGreaterThanOrEqual(2);
  });

  it("includes a supermarket where available without breaking other quotas", () => {
    const { targets } = buildPortfolio({
      candidates: [
        candidate({ ods: "I1", distanceKm: 0.1 }),
        candidate({ ods: "I2", distanceKm: 0.2 }),
        candidate({ ods: "I3", distanceKm: 0.3 }),
        candidate({ ods: "I4", distanceKm: 0.4 }),
        candidate({ ods: "S1", ownershipGroup: "asda", isSupermarket: true, distanceKm: 4.9 }),
      ],
      now: NOW,
      radiusKm: 5,
      targetCount: 4,
    });
    expect(targets.some((t) => t.isSupermarket)).toBe(true);
    expect(targets.filter((t) => t.ownershipGroup === "independent").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("portfolio.supermarket-swap — a same-chain supermarket swaps in without breaking the cap (audit P2-4)", () => {
    // chain A already holds two target slots; the ONLY supermarket is also
    // chain A. The legal move is a same-chain swap (evict a chain-A branch,
    // admit the chain-A supermarket) — the old code refused it entirely.
    const { targets } = buildPortfolio({
      candidates: [
        candidate({ ods: "A1", ownershipGroup: "chainA", distanceKm: 0.1 }),
        candidate({ ods: "A2", ownershipGroup: "chainA", distanceKm: 0.2 }),
        candidate({ ods: "I1", distanceKm: 0.3 }),
        candidate({ ods: "I2", distanceKm: 0.4 }),
        candidate({ ods: "AS", ownershipGroup: "chainA", isSupermarket: true, distanceKm: 4.5 }),
      ],
      now: NOW,
      radiusKm: 5,
      targetCount: 4,
    });
    expect(targets.some((t) => t.isSupermarket)).toBe(true);
    expect(targets.filter((t) => t.ownershipGroup === "chainA").length).toBeLessThanOrEqual(2);
    expect(targets.filter((t) => t.ownershipGroup === "independent").length).toBeGreaterThanOrEqual(2);
    // the weakest chain-A branch was the one evicted
    expect(targets.map((t) => t.ods).sort()).toEqual(["A1", "AS", "I1", "I2"]);
  });

  it("quotas are 'when available' — no invention when the pool lacks them", () => {
    const { targets } = buildPortfolio({
      candidates: [
        candidate({ ods: "B1", ownershipGroup: "boots" }),
        candidate({ ods: "B2", ownershipGroup: "boots" }),
      ],
      now: NOW,
      radiusKm: 5,
    });
    expect(targets.map((t) => t.ods).sort()).toEqual(["B1", "B2"]);
  });
});

describe("scoring & determinism", () => {
  it("weights favor history, then size/proximity, answered breaks close races", () => {
    const { targets } = buildPortfolio({
      candidates: [
        candidate({ ods: "GOOD-HISTORY", history: { calls: 4, verdicts: 4 }, distanceKm: 3 }),
        candidate({ ods: "NEAR-NO-HISTORY", distanceKm: 0.1 }),
      ],
      now: NOW,
      radiusKm: 5,
      targetCount: 1,
    });
    // 0.35*1 vs 0.35*0.5 + 0.25*(proximity edge): history wins
    expect(targets[0].ods).toBe("GOOD-HISTORY");
  });

  it("deterministic on fixture data regardless of input order", () => {
    const pool = [
      candidate({ ods: "A", distanceKm: 1 }),
      candidate({ ods: "B", distanceKm: 1 }),
      candidate({ ods: "C", distanceKm: 2, answeredBefore: true }),
      candidate({ ods: "D", ownershipGroup: "boots", distanceKm: 0.5 }),
      candidate({ ods: "E", ownershipGroup: "boots", distanceKm: 0.6 }),
      candidate({ ods: "F", ownershipGroup: "boots", distanceKm: 0.7 }),
      candidate({ ods: "G", isSupermarket: true, ownershipGroup: "tesco", distanceKm: 3 }),
    ];
    const run1 = buildPortfolio({ candidates: pool, now: NOW, radiusKm: 5 });
    const run2 = buildPortfolio({
      candidates: [...pool].reverse(),
      now: NOW,
      radiusKm: 5,
    });
    expect(run1.targets.map((t) => t.ods)).toEqual(run2.targets.map((t) => t.ods));
    expect(run1.bench.map((t) => t.ods)).toEqual(run2.bench.map((t) => t.ods));
  });

  it("bench holds everyone not targeted, ranked", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      candidate({ ods: `P${n}`, distanceKm: n * 0.5 }),
    );
    const { targets, bench } = buildPortfolio({
      candidates: pool,
      now: NOW,
      radiusKm: 5,
    });
    expect(targets).toHaveLength(6);
    expect(bench).toHaveLength(2);
    expect(bench[0].score).toBeGreaterThanOrEqual(bench[1].score);
  });
});
