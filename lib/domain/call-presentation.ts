import type { CallPhase, RankBucket } from "@/lib/search/types";

/**
 * Pure mapping from a client-visible `calls` row (the RLS-granted columns)
 * to the UI vocabulary. No I/O — unit-tested against every state the seed
 * script produces (tests/call-presentation.test.ts). The 1.5 live engine is
 * a thin pipe around this.
 */

/** The columns the anon client may select on `calls` (see init migration). */
export interface CallRowLike {
  status:
    | "queued"
    | "dialing"
    | "transcript_ready"
    | "verdict"
    | "unreached"
    | "wrong_location"
    | "extraction_failed"
    | "skipped"
    | "expired";
  rank_bucket: number | null;
  verdict: {
    stock_status?: string;
    quantity_available?: number | null;
    quantity_unit?: string | null;
    eta?: string | null;
  } | null;
  verdict_at: string | null;
}

export interface CallPresentation {
  phase: CallPhase;
  bucket?: RankBucket;
  quantityAvailable?: number | null;
  quantityUnit?: string | null;
  eta?: string | null;
  confirmedAt?: string | null;
}

export function presentCall(row: CallRowLike): CallPresentation {
  switch (row.status) {
    case "queued":
      return { phase: "queued" };
    case "dialing":
      return { phase: "dialing" };
    // Call over, extraction still running — honest middle ground: "checking".
    case "transcript_ready":
      return { phase: "asking" };
    case "verdict": {
      // A verdict row can still be bucket 4 (refused / unclear / not asked —
      // extraction succeeded, nothing was verified). It must NEVER borrow a
      // stock-verdict look (found via call-script §5 during 2.3; test
      // `verdict-row bucket 4 renders unverified`).
      if (row.rank_bucket === 4 || row.rank_bucket == null) {
        return { phase: "unverified", bucket: 4 };
      }
      const v = row.verdict ?? {};
      const base = {
        quantityAvailable: v.quantity_available ?? null,
        quantityUnit: v.quantity_unit ?? null,
        eta: v.eta ?? null,
        confirmedAt: row.verdict_at,
      };
      if (row.rank_bucket === 1) return { phase: "in-stock", bucket: 1, ...base };
      if (row.rank_bucket === 2) return { phase: "can-order", bucket: 2, ...base };
      return { phase: "no-stock", bucket: 3, ...base };
    }
    case "unreached":
      return { phase: "unreached", bucket: 4 };
    // Wrong branch answered, or extraction gave up: verified NOTHING —
    // bucket 4, never a stock verdict (DB constraints enforce the same).
    case "wrong_location":
    case "extraction_failed":
      return { phase: "unverified", bucket: 4 };
    // skipped (closed at dial time) reads the same as expired to a patient:
    // this pharmacy was not checked in time.
    case "skipped":
    case "expired":
      return { phase: "expired", bucket: 4 };
  }
}

/** "14:32" — Europe/London wall clock for "confirmed by phone at 14:32". */
export function confirmedAtLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}

/**
 * Board order per the UI contract: verdicts by bucket then distance, then
 * still-working rows (checking > calling > queued), then bucket 4 at the
 * bottom — a row that was never verified must never sit above a verdict.
 */
const PHASE_ORDER: Record<CallPhase, number> = {
  "in-stock": 1,
  "can-order": 2,
  "no-stock": 3,
  asking: 4,
  dialing: 5,
  queued: 6,
  unreached: 7,
  unverified: 8,
  expired: 9,
};

export function sortForBoard<T extends { phase: CallPhase; distanceMiles: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      a.distanceMiles - b.distanceMiles,
  );
}

/**
 * "2 boxes" / "1 box" — naive singular of the pharmacist's own unit word,
 * falling back to packs.
 */
export function quantityLabel(
  quantity: number,
  unit: string | null | undefined,
): string {
  const plural = unit?.trim() || "packs";
  return `${quantity} ${quantity === 1 ? singular(plural) : plural}`;
}

/** boxes→box, patches→patch, packs→pack, bottles→bottle. Good enough for
 *  pharmacist unit words; anything odd just renders as given. */
function singular(plural: string): string {
  if (/(?:x|ch|sh)es$/i.test(plural)) return plural.slice(0, -2);
  if (/s$/i.test(plural)) return plural.slice(0, -1);
  return plural;
}
