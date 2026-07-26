/** Landing-page demo vocabulary — deliberately separate from the product's
 *  richer state model in lib/search/types.ts (that one grows with the
 *  backend; this one is a fixed marketing animation). */
export type DemoCallPhase =
  | "queued"
  | "dialing"
  | "asking"
  | "in-stock"
  | "out-of-stock";

export interface Pharmacy {
  name: string;
  road: string;
  /** ms into the round when Relay places this call */
  startAt: number;
  dialingMs: number;
  askingMs: number;
}

/** The five pharmacies Relay calls each round. Timing is fixed per pharmacy;
 *  which one has stock changes with the medication (see MEDICATIONS).
 *  ≤3 calls are ever active at once — the animation must not advertise
 *  concurrency the dispatch invariant forbids (tests/sim-concurrency.test.ts). */
export const PHARMACIES: Pharmacy[] = [
  { name: "Boots Pharmacy", road: "High Street", startAt: 0, dialingMs: 1500, askingMs: 1700 },
  { name: "Well Pharmacy", road: "London Road", startAt: 450, dialingMs: 1600, askingMs: 2200 },
  { name: "Superdrug", road: "Station Road", startAt: 1000, dialingMs: 1500, askingMs: 1600 },
  { name: "Lloyds Pharmacy", road: "Market Square", startAt: 4100, dialingMs: 1600, askingMs: 1800 },
  { name: "Day Lewis Pharmacy", road: "Bridge Street", startAt: 4250, dialingMs: 1500, askingMs: 2000 },
];

export interface Medication {
  name: string;
  /** index into PHARMACIES of the one that has it in stock */
  winner: number;
}

/** Real UK shortages the hero cycles through, each found at a different
 *  pharmacy so no two rounds look the same. */
export const MEDICATIONS: Medication[] = [
  { name: "Propranolol 80mg MR", winner: 1 },
  { name: "Ramipril 5mg", winner: 4 },
  { name: "Estradot 50 patches", winner: 0 },
  { name: "Creon 10,000", winner: 3 },
  { name: "Oestrogel HRT", winner: 2 },
  { name: "Methylphenidate 18mg", winner: 4 },
];

export const ROUND_END = Math.max(
  ...PHARMACIES.map((p) => p.startAt + p.dialingMs + p.askingMs),
);

export function phaseFor(
  elapsed: number,
  pharmacy: Pharmacy,
  isWinner: boolean,
): DemoCallPhase {
  if (elapsed < pharmacy.startAt) return "queued";
  const t = elapsed - pharmacy.startAt;
  if (t < pharmacy.dialingMs) return "dialing";
  if (t < pharmacy.dialingMs + pharmacy.askingMs) return "asking";
  return isWinner ? "in-stock" : "out-of-stock";
}
