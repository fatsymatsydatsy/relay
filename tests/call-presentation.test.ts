import { describe, expect, it } from "vitest";
import {
  confirmedAtLabel,
  presentCall,
  quantityLabel,
  sortForBoard,
  type CallRowLike,
} from "@/lib/domain/call-presentation";

// One case per state the seed script produces (scripts/seed-fake-board.sql) —
// the mapper the live board (1.5) renders through must place every DB shape
// in the right UI phase and bucket.

function row(overrides: Partial<CallRowLike>): CallRowLike {
  return { status: "queued", rank_bucket: null, verdict: null, verdict_at: null, ...overrides };
}

describe("presentCall — every seeded state", () => {
  it("in-flight states", () => {
    expect(presentCall(row({ status: "queued" }))).toEqual({ phase: "queued" });
    expect(presentCall(row({ status: "dialing" }))).toEqual({ phase: "dialing" });
    expect(presentCall(row({ status: "transcript_ready" }))).toEqual({ phase: "asking" });
  });

  it("bucket 1: in stock, full and partial", () => {
    const full = presentCall(
      row({
        status: "verdict",
        rank_bucket: 1,
        verdict: { stock_status: "in_stock", quantity_available: 2, quantity_unit: "boxes" },
        verdict_at: "2026-07-26T13:32:00Z",
      }),
    );
    expect(full.phase).toBe("in-stock");
    expect(full.bucket).toBe(1);
    expect(full.quantityAvailable).toBe(2);
    expect(full.confirmedAt).toBe("2026-07-26T13:32:00Z");

    const partial = presentCall(
      row({
        status: "verdict",
        rank_bucket: 1,
        verdict: { stock_status: "in_stock", quantity_available: 1, quantity_unit: "boxes" },
        verdict_at: "2026-07-26T13:33:00Z",
      }),
    );
    // Partial stock is STILL bucket 1 (locked decision: quantity never disqualifies).
    expect(partial.phase).toBe("in-stock");
    expect(partial.bucket).toBe(1);
    expect(partial.quantityAvailable).toBe(1);
  });

  it("bucket 2: orderable with ETA", () => {
    const p = presentCall(
      row({
        status: "verdict",
        rank_bucket: 2,
        verdict: { stock_status: "orderable", eta: "tomorrow morning" },
        verdict_at: "2026-07-26T13:34:00Z",
      }),
    );
    expect(p.phase).toBe("can-order");
    expect(p.bucket).toBe(2);
    expect(p.eta).toBe("tomorrow morning");
  });

  it("bucket 3: plain no stock", () => {
    const p = presentCall(
      row({
        status: "verdict",
        rank_bucket: 3,
        verdict: { stock_status: "out_of_stock", quantity_available: 0 },
        verdict_at: "2026-07-26T13:35:00Z",
      }),
    );
    expect(p.phase).toBe("no-stock");
    expect(p.bucket).toBe(3);
  });

  it("bucket 4: every failure kind maps to a non-verdict phase", () => {
    expect(presentCall(row({ status: "unreached", rank_bucket: 4 }))).toEqual({
      phase: "unreached",
      bucket: 4,
    });
    expect(presentCall(row({ status: "wrong_location", rank_bucket: 4 })).phase).toBe("unverified");
    expect(presentCall(row({ status: "extraction_failed", rank_bucket: 4 })).phase).toBe("unverified");
    expect(presentCall(row({ status: "expired", rank_bucket: 4 })).phase).toBe("expired");
    expect(presentCall(row({ status: "skipped", rank_bucket: 4 })).phase).toBe("expired");
  });

  it("bucket 4 never carries stock fields", () => {
    const p = presentCall(row({ status: "unreached", rank_bucket: 4 }));
    expect(p.quantityAvailable).toBeUndefined();
    expect(p.eta).toBeUndefined();
    expect(p.confirmedAt).toBeUndefined();
  });
});

describe("confirmedAtLabel", () => {
  it("renders Europe/London wall clock (BST in July: UTC+1)", () => {
    expect(confirmedAtLabel("2026-07-26T13:32:00Z")).toBe("14:32");
  });
  it("null-safe", () => {
    expect(confirmedAtLabel(null)).toBeNull();
    expect(confirmedAtLabel("garbage")).toBeNull();
  });
});

describe("quantityLabel", () => {
  it("uses the pharmacist's unit with naive singular", () => {
    expect(quantityLabel(2, "boxes")).toBe("2 boxes");
    expect(quantityLabel(1, "boxes")).toBe("1 box");
    expect(quantityLabel(1, null)).toBe("1 pack");
  });
});

describe("sortForBoard", () => {
  it("orders bucket then distance, in-flight in the middle, bucket 4 last", () => {
    const sorted = sortForBoard([
      { phase: "unreached" as const, distanceMiles: 0.1 },
      { phase: "queued" as const, distanceMiles: 0.2 },
      { phase: "no-stock" as const, distanceMiles: 0.3 },
      { phase: "in-stock" as const, distanceMiles: 1.5 },
      { phase: "in-stock" as const, distanceMiles: 0.8 },
      { phase: "dialing" as const, distanceMiles: 0.4 },
      { phase: "can-order" as const, distanceMiles: 2.0 },
      { phase: "expired" as const, distanceMiles: 0.05 },
    ]);
    expect(sorted.map((r) => `${r.phase}@${r.distanceMiles}`)).toEqual([
      "in-stock@0.8",
      "in-stock@1.5",
      "can-order@2",
      "no-stock@0.3",
      "dialing@0.4",
      "queued@0.2",
      "unreached@0.1",
      "expired@0.05",
    ]);
  });
});
