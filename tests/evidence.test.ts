import { describe, expect, it } from "vitest";
import { buildEvidenceReport, type EvidenceCall, type EvidenceInput } from "@/lib/domain/evidence";

/**
 * 5.2.1 — the evidence report is a projection of the four log layers, and it
 * must be safe to commit to a PUBLIC repo: transcript bodies never leak into
 * it, and DEV_TEST team numbers are masked (REAL pharmacy numbers are public
 * NHS directory data and stay visible — they ARE the evidence).
 */

const call = (over: Partial<EvidenceCall> = {}): EvidenceCall => ({
  pharmacy_name: "Al-Shifa Pharmacy",
  pharmacy_ods: "FA111",
  status: "verdict",
  is_bench: false,
  dial_mode: "REAL",
  resolved_number: "+441214490300",
  claimed_at: "2026-07-26T09:45:01Z",
  ended_at: "2026-07-26T09:46:30Z",
  verdict_at: "2026-07-26T09:46:41Z",
  rank_bucket: 1,
  location_confirmed: "yes",
  verdict: {
    stock_status: "in_stock",
    quantity_available: 2,
    quantity_unit: "boxes",
    quantity_meets_need: "yes",
    eta_days: null,
    eta_label: null,
    shortage_mentioned: false,
    outcome: "completed",
  },
  ...over,
});

const input = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  search: {
    id: "3f9d2c81-0000-0000-0000-000000000000",
    dial_mode: "REAL",
    medication_name: "Creon 25,000",
    quantity_needed: 2,
    postcode: "B5 4BU",
    status: "complete",
    created_at: "2026-07-26T09:45:00Z",
    deadline_at: "2026-07-26T10:05:00Z",
    settled_at: "2026-07-26T09:48:12Z",
  },
  calls: [call()],
  dialLog: [{ phone: "+441214490300", outcome: "connected", dialed_at: "2026-07-26T09:45:02Z" }],
  eventCounts: { post_call_transcription: 1 },
  generatedAt: "2026-07-26T09:50:00Z",
  ...over,
});

describe("buildEvidenceReport", () => {
  it("headline carries search id, mode, medication, postcode and wall-clock duration", () => {
    const md = buildEvidenceReport(input());
    expect(md).toContain("3f9d2c81");
    expect(md).toContain("DIAL_MODE=REAL");
    expect(md).toContain("Creon 25,000");
    expect(md).toContain("B5 4BU");
    expect(md).toContain("3m12s"); // 09:45:00 → 09:48:12
  });

  it("renders one row per call with bucket and verdict summary; bench rows say never dialed", () => {
    const md = buildEvidenceReport(
      input({
        calls: [
          call(),
          call({
            pharmacy_name: "Olive Tree Pharmacy",
            pharmacy_ods: "FB222",
            status: "expired",
            is_bench: true,
            resolved_number: null,
            claimed_at: null,
            rank_bucket: null,
            location_confirmed: null,
            verdict: null,
          }),
        ],
      }),
    );
    expect(md).toContain("| Al-Shifa Pharmacy ");
    expect(md).toContain("b1 in_stock");
    expect(md).toContain("2 boxes");
    expect(md).toMatch(/Olive Tree Pharmacy.*bench, never dialed/);
  });

  it("cross-layer table: dialed calls vs dial_log vs webhook events, plus the politeness proof", () => {
    const md = buildEvidenceReport(input());
    expect(md).toContain("| calls rows dialed | 1 |");
    expect(md).toContain("| dial_log connected | 1 (1 distinct numbers) |");
    expect(md).toContain("| call_events webhooks | 1 |");
    expect(md).toContain("every dialed number distinct — one dial per number held");
  });

  it("flags a politeness violation (two CONNECTED dials to one number) instead of hiding it", () => {
    const md = buildEvidenceReport(
      input({
        dialLog: [
          { phone: "+441214490300", outcome: "connected", dialed_at: "2026-07-26T09:45:02Z" },
          { phone: "+441214490300", outcome: "connected", dialed_at: "2026-07-26T09:59:02Z" },
        ],
      }),
    );
    expect(md).toContain("⚠️ DUPLICATE DIALS");
    expect(md).not.toContain("one dial per number held");
  });

  it("a freed row for the same number is NOT a duplicate dial — provider reject then legit reclaim", () => {
    const md = buildEvidenceReport(
      input({
        dialLog: [
          { phone: "+441214490300", outcome: "freed", dialed_at: "2026-07-26T09:45:02Z" },
          { phone: "+441214490300", outcome: "connected", dialed_at: "2026-07-26T09:46:02Z" },
        ],
      }),
    );
    expect(md).not.toContain("⚠️ DUPLICATE DIALS");
    expect(md).toContain("one dial per number held");
    expect(md).toContain("| dial_log connected | 1 (1 distinct numbers) |");
    expect(md).toContain("1 freed (provider reject — number unblocked)");
  });

  it("never renders dial_log phone numbers at all (team phones may pass through unmasked)", () => {
    const md = buildEvidenceReport(
      input({
        dialLog: [
          { phone: "+447911114061", outcome: "connected", dialed_at: "2026-07-26T09:45:02Z" },
        ],
      }),
    );
    expect(md).not.toContain("+447911114061");
    expect(md).not.toContain("114061");
  });

  it("NEVER leaks transcript bodies, even when callers pass them in the rows", () => {
    const marker = "PHARMACIST-SAID-SOMETHING-PRIVATE-XYZZY";
    const md = buildEvidenceReport(
      input({
        calls: [
          // deliberately smuggle transcript-shaped fields into the row
          { ...call(), transcript: { transcript: [{ message: marker }] } } as EvidenceCall,
        ],
      }),
    );
    expect(md).not.toContain(marker);
    expect(md).toContain("Raw transcripts remain in Postgres");
  });

  it("masks DEV_TEST team numbers to last-6 but shows REAL pharmacy numbers in full", () => {
    const md = buildEvidenceReport(
      input({
        calls: [
          call(),
          call({
            pharmacy_name: "St Martins Chemist",
            pharmacy_ods: "X99001",
            dial_mode: "DEV_TEST",
            resolved_number: "+447911114061",
            rank_bucket: 2,
            verdict: {
              stock_status: "orderable",
              quantity_available: null,
              quantity_unit: null,
              quantity_meets_need: "unknown",
              eta_days: 4,
              eta_label: "four days",
              shortage_mentioned: false,
              outcome: "completed",
            },
          }),
        ],
      }),
    );
    expect(md).toContain("+441214490300"); // REAL: full number is the evidence
    expect(md).not.toContain("+447911114061"); // DEV_TEST: team phone masked
    expect(md).toContain("…114061");
    expect(md).toContain("b2 orderable");
    expect(md).toContain("four days");
  });

  it("bucket 4 NEVER renders stock words — even when a verdict object is smuggled onto the row", () => {
    const md = buildEvidenceReport(
      input({
        calls: [
          call({
            status: "unreached",
            rank_bucket: 4,
            location_confirmed: null,
            // DB constraints forbid this upstream; the renderer must still refuse
            verdict: {
              stock_status: "in_stock",
              quantity_available: 9,
              quantity_unit: "boxes",
              quantity_meets_need: "yes",
              eta_days: null,
              eta_label: null,
              shortage_mentioned: false,
              outcome: "completed",
            },
            verdict_at: null,
          }),
        ],
      }),
    );
    expect(md).toMatch(/b4 unreached/);
    expect(md).not.toMatch(/b4[^\n]*in_stock/);
    expect(md).not.toContain("9 boxes");
  });
});
