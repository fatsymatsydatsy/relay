import { z } from "zod";

/**
 * Verdict schema + bucket mapper (2.3) — the contract with extract_result.
 *
 * ExtractionSchema mirrors pharmacy-call-agent-script.md §5 exactly: it is
 * what the LLM extractor must produce from a transcript (verbatim fields stay
 * verbatim). The mapper then derives the database verdict: rank bucket,
 * calls.status, and the verdict jsonb the UI projects. The same "schema
 * teeth" the DB enforces are enforced here, so bad extractions die before
 * they ever reach a row.
 */

export const ExtractionSchema = z
  .object({
    call_ref: z.string().min(1),
    outcome: z.enum([
      "completed",
      "voicemail",
      "wrong_location",
      "national_line",
      "refused",
      "incomplete",
    ]),
    location_confirmed: z.enum(["yes", "no", "unclear"]),
    stock_status: z.enum(["in_stock", "out_of_stock", "unclear", "not_asked"]),
    quantity_available_verbatim: z.string().nullable(),
    quantity_meets_need: z.enum(["yes", "no", "unknown"]),
    orderable: z.enum(["yes", "no", "unknown"]),
    eta_verbatim: z.string().nullable(),
    shortage_mentioned: z.boolean(),
    notable_quotes: z.array(z.string()).max(2),
  })
  .superRefine((v, ctx) => {
    const claimsStock =
      v.stock_status === "in_stock" || v.stock_status === "out_of_stock";
    if (claimsStock && !(v.location_confirmed === "yes" && v.outcome === "completed")) {
      ctx.addIssue({
        code: "custom",
        message:
          "stock_status may only be in_stock/out_of_stock when location_confirmed=yes AND outcome=completed",
      });
    }
    if (["voicemail", "wrong_location", "national_line"].includes(v.outcome)) {
      const carriesStockFields =
        v.stock_status !== "not_asked" ||
        v.quantity_available_verbatim !== null ||
        v.orderable !== "unknown" ||
        v.eta_verbatim !== null;
      if (carriesStockFields) {
        ctx.addIssue({
          code: "custom",
          message: `${v.outcome} can never carry stock fields`,
        });
      }
    }
  });

export type Extraction = z.infer<typeof ExtractionSchema>;

/** The verdict jsonb stored on calls rows — CLIENT-GRANTED, so structured
 *  fields ONLY. Verbatim transcript excerpts (notable quotes, quantity/eta
 *  phrasing) are PII-bearing evidence and live in the service-only
 *  `calls.extraction` column instead (audit P1-4); `eta_label` is a synthetic
 *  display string derived from eta_days, never a quote. */
export interface VerdictJson {
  stock_status: "in_stock" | "out_of_stock" | "orderable" | "unclear";
  quantity_available: number | null;
  quantity_unit: string | null;
  quantity_meets_need: "yes" | "no" | "unknown";
  eta_days: number | null;
  eta_label: string | null;
  shortage_mentioned: boolean;
  outcome: Extraction["outcome"];
}

export interface MappedVerdict {
  dbStatus: "verdict" | "unreached" | "wrong_location";
  bucket: 1 | 2 | 3 | 4;
  locationConfirmed: "yes" | "no" | "unclear";
  verdict: VerdictJson | null;
  /** Voice-driven store picker — ops should mark the number national. */
  flagNationalLine: boolean;
}

/**
 * Extraction → database verdict. The type system makes the invariant hold:
 * buckets 1–3 exist ONLY on the completed/location-yes paths; everything
 * else — wrong branch, voicemail, national line, refusal, unclear — is
 * bucket 4 and never carries a stock claim (`bucket.wrong-location`).
 */
export function mapExtraction(x: Extraction, now: Date): MappedVerdict {
  const base = {
    locationConfirmed: x.location_confirmed,
    flagNationalLine: x.outcome === "national_line",
  };

  if (x.outcome === "voicemail" || x.outcome === "national_line") {
    return { ...base, dbStatus: "unreached", bucket: 4, verdict: null };
  }
  if (x.outcome === "wrong_location" || x.location_confirmed !== "yes") {
    return { ...base, dbStatus: "wrong_location", bucket: 4, verdict: null };
  }

  // completed (or refused/incomplete) on the RIGHT branch from here on
  const quantity = parseQuantity(x.quantity_available_verbatim);
  const days = etaDays(x.eta_verbatim, now);
  const shared = {
    quantity_available: quantity?.amount ?? null,
    quantity_unit: quantity?.unit ?? null,
    quantity_meets_need: x.quantity_meets_need,
    eta_days: days,
    eta_label: etaLabel(days, now),
    shortage_mentioned: x.shortage_mentioned,
    outcome: x.outcome,
  };

  if (x.outcome === "completed" && x.stock_status === "in_stock") {
    return {
      ...base,
      dbStatus: "verdict",
      bucket: 1, // partial stock is still bucket 1 — quantity never disqualifies
      verdict: { stock_status: "in_stock", ...shared },
    };
  }
  if (x.outcome === "completed" && x.stock_status === "out_of_stock") {
    if (x.orderable === "yes") {
      return {
        ...base,
        dbStatus: "verdict",
        bucket: 2,
        verdict: { stock_status: "orderable", ...shared },
      };
    }
    return {
      ...base,
      dbStatus: "verdict",
      bucket: 3,
      verdict: { stock_status: "out_of_stock", ...shared },
    };
  }

  // refused / incomplete / stock unclear or not asked: reached the right
  // branch but verified nothing — an honest bucket-4 "verdict" row (the
  // payload keeps the outcome for provenance; UI renders it as unverified).
  return {
    ...base,
    dbStatus: "verdict",
    bucket: 4,
    verdict: { stock_status: "unclear", ...shared },
  };
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  couple: 2, dozen: 12,
  // "few"/"some"/"several" deliberately absent: a vague amount must never
  // become a precise number on the board (audit P2-2)
};

/** Pharmacist unit words — a digit only counts as a quantity when it sits
 *  next to one of these (or is the utterance's ONLY number). Strength digits
 *  ("the 25,000") must never be read as an amount (audit P2-2). */
const UNIT_WORDS = [
  "box", "boxes", "pack", "packs", "packet", "packets", "tub", "tubs",
  "bottle", "bottles", "tablet", "tablets", "capsule", "capsules",
  "strip", "strips", "inhaler", "inhalers", "pen", "pens", "vial", "vials",
  "tube", "tubes", "unit", "units",
];
const UNIT_ALT = UNIT_WORDS.join("|");

/** Conservative quantity reader: "two boxes" → {2, "boxes"}; "1 box" →
 *  {1, "box"}; "two boxes of the 25,000" → {2, "boxes"}; "25,000" alone,
 *  "a few", "loads" → null. When in doubt, claim nothing — the verbatim
 *  stays server-side in calls.extraction. */
export function parseQuantity(
  verbatim: string | null,
): { amount: number; unit: string | null } | null {
  if (!verbatim) return null;
  const text = verbatim.toLowerCase().trim();

  // 1) digits immediately next to a known unit word
  const digitUnit = new RegExp(`\\b(\\d{1,3})\\s*(${UNIT_ALT})\\b`).exec(text);
  if (digitUnit) return { amount: Number(digitUnit[1]), unit: digitUnit[2] };

  // 2) a number word, with its unit when present ("a couple of packs")
  for (const [word, amount] of Object.entries(WORD_NUMBERS)) {
    const m = new RegExp(`\\b${word}\\b(?:\\s+(?:of\\s+)?(${UNIT_ALT}))?\\b`).exec(text);
    if (m) return { amount, unit: m[1] ?? null };
  }

  // 3) a bare number — only when it is the utterance's ONLY number, small,
  //    and not comma/point-grouped strength digits ("25,000", "1.5")
  if (!/\d[,.]\d/.test(text)) {
    const numbers = text.match(/\d+/g) ?? [];
    if (numbers.length === 1 && Number(numbers[0]) <= 200) {
      return { amount: Number(numbers[0]), unit: null };
    }
  }

  // 4) "a box" = 1 — an article counts only with an explicit unit
  const article = new RegExp(`\\b(?:a|an)\\s+(${UNIT_ALT})\\b`).exec(text);
  if (article) return { amount: 1, unit: article[1] };

  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Synthetic eta display derived from eta_days — NEVER the pharmacist's
 *  words (those stay in the service-only extraction record). 0 → "today",
 *  1 → "tomorrow", 2–6 → the London weekday name, 7 → "next week". */
export function etaLabel(days: number | null, now: Date): string | null {
  if (days === null) return null;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days >= 2 && days <= 6) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "long",
    }).format(new Date(now.getTime() + days * 86_400_000));
  }
  if (days === 7) return "next week";
  return `in ${days} days`;
}

/** "tomorrow morning" → 1 · "Thursday at the earliest" → days until next
 *  Thursday (London) · "in 3 days" → 3 · unparseable → null (bucket-2 rows
 *  sort by eta_days, nulls last). */
export function etaDays(verbatim: string | null, now: Date): number | null {
  if (!verbatim) return null;
  const text = verbatim.toLowerCase();
  if (text.includes("today") || text.includes("this afternoon") || text.includes("later on")) return 0;
  if (text.includes("tomorrow")) return 1;
  const inDays = /in\s+(\d+)\s+day/.exec(text);
  if (inDays) return Number(inDays[1]);
  if (text.includes("next week")) return 7;

  const todayIdx = WEEKDAYS.indexOf(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" })
      .format(now)
      .toLowerCase(),
  );
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (text.includes(WEEKDAYS[i])) {
      const delta = (i - todayIdx + 7) % 7;
      return delta === 0 ? 7 : delta; // "Thursday" said ON a Thursday = next week
    }
  }
  return null;
}
