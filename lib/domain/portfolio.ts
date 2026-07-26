import {
  isOpenAt,
  staysOpenFor,
  weeklyOpenMinutes,
  type OpeningHours,
} from "./opening-hours";

/**
 * Portfolio scorer (2.2) — who gets called, pure logic.
 *
 * Radius = candidate pool (create_search pre-filters). Three stages
 * (docs/architecture.md §Who gets called):
 *   1. THROW-OUT: closed now, or closing within the hour → never called.
 *   2. SCORE: history 0.35 · size proxy (weekly hours) 0.25 · proximity 0.25
 *      · answered-before 0.15.
 *   3. CONSTRAINED PICK: ≤2 per ownership chain (same chain = same wholesaler
 *      = correlated stockouts) · ≥2 independents when available · ≥1
 *      supermarket where available. Deterministic: ties break by distance,
 *      then ODS code.
 *
 * Returns targets (top N) + bench (everyone else, ranked) — the bench
 * replaces dead calls one-for-one (no retries).
 */

export interface Candidate {
  ods: string;
  distanceKm: number;
  hours: OpeningHours;
  /** "independent" or a chain key ("boots", "reavalley", …). */
  ownershipGroup: string;
  isSupermarket: boolean;
  /** Prior calls/verdicts for THIS pharmacy from our own history. */
  history: { calls: number; verdicts: number };
  answeredBefore: boolean;
}

export interface ScoredCandidate extends Candidate {
  score: number;
}

export interface PortfolioInput {
  candidates: Candidate[];
  now: Date;
  radiusKm: number;
  /** How many to dial first (default 6). */
  targetCount?: number;
  /** The stay-open throw-out horizon in minutes (default 60). */
  minStayOpenMinutes?: number;
}

export interface Portfolio {
  targets: ScoredCandidate[];
  bench: ScoredCandidate[];
  thrownOut: { ods: string; reason: "closed" | "closing_soon" }[];
}

const WEIGHTS = { history: 0.35, size: 0.25, proximity: 0.25, answered: 0.15 };
const MAX_PER_CHAIN = 2;
const MIN_INDEPENDENTS = 2;
const MIN_SUPERMARKETS = 1;

export function buildPortfolio(input: PortfolioInput): Portfolio {
  const {
    candidates,
    now,
    radiusKm,
    targetCount = 6,
    minStayOpenMinutes = 60,
  } = input;

  // 1. throw-out
  const thrownOut: Portfolio["thrownOut"] = [];
  const alive: Candidate[] = [];
  for (const c of candidates) {
    if (!isOpenAt(c.hours, now)) {
      thrownOut.push({ ods: c.ods, reason: "closed" });
    } else if (!staysOpenFor(c.hours, minStayOpenMinutes, now)) {
      thrownOut.push({ ods: c.ods, reason: "closing_soon" });
    } else {
      alive.push(c);
    }
  }

  // 2. score
  const maxWeekly = Math.max(...alive.map((c) => weeklyOpenMinutes(c.hours)), 1);
  const scored: ScoredCandidate[] = alive
    .map((c) => {
      const historyScore =
        c.history.calls > 0 ? c.history.verdicts / c.history.calls : 0.5;
      const sizeScore = weeklyOpenMinutes(c.hours) / maxWeekly;
      const proximityScore = Math.max(0, Math.min(1, 1 - c.distanceKm / radiusKm));
      const answeredScore = c.answeredBefore ? 1 : 0;
      return {
        ...c,
        score:
          WEIGHTS.history * historyScore +
          WEIGHTS.size * sizeScore +
          WEIGHTS.proximity * proximityScore +
          WEIGHTS.answered * answeredScore,
      };
    })
    .sort(byRank);

  // 3. constrained pick: greedy with the chain cap…
  const targets: ScoredCandidate[] = [];
  const overflow: ScoredCandidate[] = [];
  const perChain = new Map<string, number>();
  for (const c of scored) {
    const isChain = c.ownershipGroup !== "independent";
    const used = perChain.get(c.ownershipGroup) ?? 0;
    if (targets.length < targetCount && (!isChain || used < MAX_PER_CHAIN)) {
      targets.push(c);
      perChain.set(c.ownershipGroup, used + 1);
    } else {
      overflow.push(c);
    }
  }

  // …then guarantee diversity by swapping out the weakest eligible targets.
  ensureQuota(
    targets,
    overflow,
    (c) => c.ownershipGroup === "independent",
    MIN_INDEPENDENTS,
    { protectIndependents: false },
  );
  ensureQuota(targets, overflow, (c) => c.isSupermarket, MIN_SUPERMARKETS, {
    protectIndependents: true,
  });

  targets.sort(byRank);
  const bench = overflow.sort(byRank);
  return { targets, bench, thrownOut };
}

/**
 * Swap lowest-ranked non-matching targets for best matching bench entries
 * until `min` members match (or the pool runs out). Swaps never violate the
 * chain cap, and the supermarket pass never evicts below the independent
 * quota (protectIndependents).
 */
function ensureQuota(
  targets: ScoredCandidate[],
  overflow: ScoredCandidate[],
  matches: (c: ScoredCandidate) => boolean,
  min: number,
  opts: { protectIndependents: boolean },
) {
  let have = targets.filter(matches).length;
  while (have < min) {
    const chainCount = (group: string) =>
      targets.filter((t) => t.ownershipGroup === group).length;
    const incoming = overflow
      .filter(matches)
      .sort(byRank)
      .find(
        (c) =>
          c.ownershipGroup === "independent" ||
          chainCount(c.ownershipGroup) < MAX_PER_CHAIN,
      );
    if (!incoming) return; // none available — quotas are "when available"

    const independents = targets.filter(
      (t) => t.ownershipGroup === "independent",
    ).length;
    const outgoing = [...targets]
      .filter(
        (c) =>
          !matches(c) &&
          !(
            opts.protectIndependents &&
            c.ownershipGroup === "independent" &&
            independents <= MIN_INDEPENDENTS
          ),
      )
      .sort(byRank)
      .at(-1);
    if (!outgoing) return;

    targets.splice(targets.indexOf(outgoing), 1, incoming);
    overflow.splice(overflow.indexOf(incoming), 1);
    overflow.push(outgoing);
    have++;
  }
}

/** score desc → distance asc → ods asc: fully deterministic on fixtures. */
function byRank(a: ScoredCandidate, b: ScoredCandidate): number {
  return b.score - a.score || a.distanceKm - b.distanceKm || a.ods.localeCompare(b.ods);
}
