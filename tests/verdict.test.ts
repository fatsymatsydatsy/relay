import { describe, expect, it } from "vitest";
import {
  ExtractionSchema,
  etaDays,
  mapExtraction,
  parseQuantity,
  type Extraction,
} from "@/lib/domain/verdict";
import { presentCall } from "@/lib/domain/call-presentation";

// Sat 25 Jul 2026 (London). etaDays cases pivot on this.
const NOW = new Date("2026-07-25T10:00:00Z");

function extraction(overrides: Partial<Extraction>): Extraction {
  return ExtractionSchema.parse({
    call_ref: "call-1",
    outcome: "completed",
    location_confirmed: "yes",
    stock_status: "not_asked",
    quantity_available_verbatim: null,
    quantity_meets_need: "unknown",
    orderable: "unknown",
    eta_verbatim: null,
    shortage_mentioned: false,
    notable_quotes: [],
    ...overrides,
  });
}

describe("ExtractionSchema — §5 worked examples validate", () => {
  it("'two boxes of the 25,000'", () => {
    expect(() =>
      extraction({
        stock_status: "in_stock",
        quantity_available_verbatim: "two boxes",
        quantity_meets_need: "yes",
      }),
    ).not.toThrow();
  });

  it("'no stock, orderable Thursday, shortage mentioned'", () => {
    expect(() =>
      extraction({
        stock_status: "out_of_stock",
        orderable: "yes",
        eta_verbatim: "Thursday at the earliest",
        shortage_mentioned: true,
      }),
    ).not.toThrow();
  });
});

describe("ExtractionSchema — forbidden combos rejected (schema teeth)", () => {
  it("stock claim without a confirmed branch", () => {
    expect(() =>
      extraction({ stock_status: "in_stock", location_confirmed: "unclear" }),
    ).toThrow(/location_confirmed=yes/);
  });

  it("stock claim on a non-completed call", () => {
    expect(() =>
      extraction({ stock_status: "in_stock", outcome: "refused" }),
    ).toThrow(/completed/);
  });

  it("voicemail carrying stock fields", () => {
    expect(() =>
      extraction({
        outcome: "voicemail",
        location_confirmed: "unclear",
        quantity_available_verbatim: "two boxes",
      }),
    ).toThrow(/never carry stock fields/);
  });

  it("more than two notable quotes", () => {
    expect(() =>
      extraction({ notable_quotes: ["a", "b", "c"] }),
    ).toThrow();
  });
});

describe("mapExtraction — buckets", () => {
  it("in stock (partial counts — quantity never disqualifies) → bucket 1", () => {
    const m = mapExtraction(
      extraction({
        stock_status: "in_stock",
        quantity_available_verbatim: "1 box",
        quantity_meets_need: "no",
      }),
      NOW,
    );
    expect(m.bucket).toBe(1);
    expect(m.dbStatus).toBe("verdict");
    expect(m.verdict?.stock_status).toBe("in_stock");
    expect(m.verdict?.quantity_available).toBe(1);
    expect(m.verdict?.quantity_unit).toBe("box");
  });

  it("out of stock but orderable → bucket 2 with eta_days", () => {
    const m = mapExtraction(
      extraction({
        stock_status: "out_of_stock",
        orderable: "yes",
        eta_verbatim: "Thursday at the earliest",
      }),
      NOW,
    );
    expect(m.bucket).toBe(2);
    expect(m.verdict?.stock_status).toBe("orderable");
    expect(m.verdict?.eta_days).toBe(5); // Sat → next Thu
  });

  it("plain no stock → bucket 3", () => {
    const m = mapExtraction(
      extraction({ stock_status: "out_of_stock", orderable: "no", shortage_mentioned: true }),
      NOW,
    );
    expect(m.bucket).toBe(3);
    expect(m.verdict?.shortage_mentioned).toBe(true);
  });

  it("bucket.wrong-location — wrong branch can NEVER be buckets 1–3", () => {
    const wrong = mapExtraction(
      extraction({ outcome: "wrong_location", location_confirmed: "no" }),
      NOW,
    );
    expect(wrong.bucket).toBe(4);
    expect(wrong.dbStatus).toBe("wrong_location");
    expect(wrong.verdict).toBeNull();

    // even a completed call with an UNCONFIRMED branch is bucket 4, no payload
    const unclear = mapExtraction(
      extraction({ location_confirmed: "unclear" }),
      NOW,
    );
    expect(unclear.bucket).toBe(4);
    expect(unclear.dbStatus).toBe("wrong_location");
    expect(unclear.verdict).toBeNull();
  });

  it("voicemail / national line → unreached, bucket 4, flagged", () => {
    const vm = mapExtraction(
      extraction({ outcome: "voicemail", location_confirmed: "unclear" }),
      NOW,
    );
    expect(vm).toMatchObject({ dbStatus: "unreached", bucket: 4, verdict: null });

    const nl = mapExtraction(
      extraction({ outcome: "national_line", location_confirmed: "unclear" }),
      NOW,
    );
    expect(nl.flagNationalLine).toBe(true);
    expect(nl.bucket).toBe(4);
  });

  it("refused / unclear → bucket-4 verdict row that renders as unverified", () => {
    const m = mapExtraction(
      extraction({ outcome: "refused", stock_status: "unclear" }),
      NOW,
    );
    expect(m.bucket).toBe(4);
    expect(m.dbStatus).toBe("verdict");
    expect(m.verdict?.stock_status).toBe("unclear");

    // regression: a verdict-status row with bucket 4 must NOT look like a
    // stock verdict on the board
    const phase = presentCall({
      status: "verdict",
      rank_bucket: 4,
      verdict: { stock_status: "unclear" },
      verdict_at: "2026-07-25T10:05:00Z",
    });
    expect(phase.phase).toBe("unverified");
    expect(phase.quantityAvailable).toBeUndefined();
  });
});

describe("normalizers", () => {
  it("parseQuantity", () => {
    expect(parseQuantity("two boxes")).toEqual({ amount: 2, unit: "boxes" });
    expect(parseQuantity("1 box")).toEqual({ amount: 1, unit: "box" });
    expect(parseQuantity("a couple of packs")).toEqual({ amount: 2, unit: "packs" });
    expect(parseQuantity("loads")).toBeNull();
    expect(parseQuantity(null)).toBeNull();
  });

  it("etaDays from a Saturday", () => {
    expect(etaDays("tomorrow morning", NOW)).toBe(1);
    expect(etaDays("later today", NOW)).toBe(0);
    expect(etaDays("Thursday at the earliest", NOW)).toBe(5);
    expect(etaDays("saturday", NOW)).toBe(7); // same weekday = next week
    expect(etaDays("in 3 days", NOW)).toBe(3);
    expect(etaDays("next week", NOW)).toBe(7);
    expect(etaDays("when the van comes", NOW)).toBeNull();
    expect(etaDays(null, NOW)).toBeNull();
  });
});
