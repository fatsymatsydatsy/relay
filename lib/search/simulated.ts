import type {
  ConnectCallbacks,
  NominatedPharmacy,
  PharmacyResult,
  SearchCallbacks,
  SearchEngine,
  SearchHandle,
  SearchRequest,
} from "./types";

/**
 * Scripted stand-in for the real calling product.
 *
 * It replays a realistic round of pharmacy calls on timers so the /search UI
 * can be demoed end to end with no backend, covering EVERY state the real
 * board can show (the same set scripts/seed-fake-board.sql seeds). Replace
 * with the live engine (1.5) — the UI won't change.
 *
 * Timings keep ≤3 calls in dialing/asking at once: the demo must never show
 * behavior the dispatch invariant forbids (CLAUDE.md; enforced by
 * tests/sim-concurrency.test.ts).
 */

type Outcome =
  | { kind: "in-stock"; quantity: number; unit: string }
  | { kind: "can-order"; eta: string }
  | { kind: "no-stock" }
  | { kind: "unreached" }
  | { kind: "unverified" }
  | { kind: "expired" };

export interface CallScript {
  id: string;
  name: string;
  road: string;
  address: string;
  distanceMiles: number;
  bearing: number;
  hours: string;
  phone: string;
  /** null = never dialed this round (queued until the search expires). */
  startAt: number | null;
  dialingMs: number;
  askingMs: number;
  outcome: Outcome;
}

const TICK_MS = 100;
const RESOLVE_HOLD_MS = 700;

/** Phones are the Ofcom drama range — never real numbers. */
export const SCRIPT: CallScript[] = [
  {
    id: "boots-high-st",
    name: "Boots Pharmacy",
    road: "High Street",
    address: "42 High Street",
    distanceMiles: 0.3,
    bearing: 35,
    hours: "Mon–Sat 9:00–18:00",
    phone: "020 7946 0031",
    startAt: 0,
    dialingMs: 1500,
    askingMs: 1700,
    outcome: { kind: "no-stock" },
  },
  {
    id: "superdrug-station",
    name: "Superdrug Pharmacy",
    road: "Station Road",
    address: "8 Station Road",
    distanceMiles: 0.5,
    bearing: 305,
    hours: "Mon–Sat 8:30–19:00",
    phone: "020 7946 0074",
    // rings out: full dialing window, never answered
    startAt: 450,
    dialingMs: 3100,
    askingMs: 0,
    outcome: { kind: "unreached" },
  },
  {
    id: "well-london-rd",
    name: "Well Pharmacy",
    road: "London Road",
    address: "119 London Road",
    distanceMiles: 0.8,
    bearing: 130,
    hours: "Mon–Fri 9:00–18:30, Sat 9:00–13:00",
    phone: "020 7946 0112",
    startAt: 1000,
    dialingMs: 1600,
    askingMs: 2200,
    outcome: { kind: "in-stock", quantity: 2, unit: "boxes" },
  },
  {
    id: "lloyds-market-sq",
    name: "Lloyds Pharmacy",
    road: "Market Square",
    address: "3 Market Square",
    distanceMiles: 1.1,
    bearing: 215,
    hours: "Mon–Sat 9:00–17:30",
    phone: "020 7946 0158",
    startAt: 3300, // waits for the first line to free (≤3 in flight)
    dialingMs: 1600,
    askingMs: 1800,
    outcome: { kind: "can-order", eta: "tomorrow morning" },
  },
  {
    id: "day-lewis-bridge",
    name: "Day Lewis Pharmacy",
    road: "Bridge Street",
    address: "27 Bridge Street",
    distanceMiles: 1.6,
    bearing: 345,
    hours: "Mon–Sat 8:00–18:00",
    phone: "020 7946 0203",
    startAt: 3700,
    dialingMs: 1500,
    askingMs: 2000,
    outcome: { kind: "in-stock", quantity: 1, unit: "boxes" }, // partial vs 2 needed
  },
  {
    id: "rowlands-church-ln",
    name: "Rowlands Pharmacy",
    road: "Church Lane",
    address: "5 Church Lane",
    distanceMiles: 1.2,
    bearing: 80,
    hours: "Mon–Fri 8:30–18:00",
    phone: "020 7946 0090",
    startAt: 4900,
    dialingMs: 1500,
    askingMs: 1700,
    outcome: { kind: "no-stock" },
  },
  {
    id: "jhoots-mill-rd",
    name: "Jhoots Pharmacy",
    road: "Mill Road",
    address: "61 Mill Road",
    distanceMiles: 1.9,
    bearing: 250,
    hours: "Mon–Sat 9:00–18:30",
    phone: "020 7946 0144",
    // answers, but it's the wrong branch — verified nothing
    startAt: 6800,
    dialingMs: 1400,
    askingMs: 1400,
    outcome: { kind: "unverified" },
  },
  {
    id: "cohens-park-st",
    name: "Cohens Chemist",
    road: "Park Street",
    address: "18 Park Street",
    distanceMiles: 2.2,
    bearing: 170,
    hours: "Mon–Fri 9:00–18:00",
    phone: "020 7946 0177",
    startAt: 7300,
    dialingMs: 1500,
    askingMs: 1600,
    outcome: { kind: "can-order", eta: "Thursday" },
  },
  {
    id: "tesco-canal-way",
    name: "Tesco Pharmacy",
    road: "Canal Way",
    address: "Unit 2, Canal Way",
    distanceMiles: 2.6,
    bearing: 20,
    hours: "Mon–Sun 8:00–22:00",
    phone: "020 7946 0199",
    // never dialed this round: queued all along, expires when time runs out
    startAt: null,
    dialingMs: 0,
    askingMs: 0,
    outcome: { kind: "expired" },
  },
];

const SCRIPT_END = Math.max(
  ...SCRIPT.filter((c) => c.startAt !== null).map(
    (c) => (c.startAt as number) + c.dialingMs + c.askingMs,
  ),
);

/** Peak number of simultaneously active (dialing/asking) calls in a script —
 *  pure, so the ≤3 invariant is unit-testable. Never-dialed rows don't count. */
export function maxConcurrent(
  script: ReadonlyArray<Pick<CallScript, "startAt" | "dialingMs" | "askingMs">>,
): number {
  const events = script
    .filter((c) => c.startAt !== null)
    .flatMap((c) => [
      { at: c.startAt as number, delta: +1 },
      { at: (c.startAt as number) + c.dialingMs + c.askingMs, delta: -1 },
    ]);
  // ends sort before starts at the same instant: a freed line can be reused
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const e of events) {
    active += e.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

function terminalPhase(outcome: Outcome): PharmacyResult["phase"] {
  switch (outcome.kind) {
    case "in-stock":
      return "in-stock";
    case "can-order":
      return "can-order";
    case "no-stock":
      return "no-stock";
    case "unreached":
      return "unreached";
    case "unverified":
      return "unverified";
    case "expired":
      return "expired";
  }
}

function resultAt(elapsed: number, call: CallScript, now: number): PharmacyResult {
  const base: PharmacyResult = {
    id: call.id,
    name: call.name,
    road: call.road,
    address: call.address,
    distanceMiles: call.distanceMiles,
    bearing: call.bearing,
    hours: call.hours,
    phone: call.phone,
    phase: "queued",
  };

  // Never dialed: queued while the search runs, expired once it settles.
  if (call.startAt === null) {
    return elapsed >= SCRIPT_END
      ? { ...base, phase: "expired", bucket: 4 }
      : base;
  }

  if (elapsed < call.startAt) return base;
  const t = elapsed - call.startAt;
  if (t < call.dialingMs) return { ...base, phase: "dialing" };
  if (t < call.dialingMs + call.askingMs) return { ...base, phase: "asking" };

  const resolvedAtMs = now - (elapsed - (call.startAt + call.dialingMs + call.askingMs));
  const o = call.outcome;
  switch (o.kind) {
    case "in-stock":
      return {
        ...base,
        phase: "in-stock",
        bucket: 1,
        quantityAvailable: o.quantity,
        quantityUnit: o.unit,
        confirmedAt: new Date(resolvedAtMs).toISOString(),
      };
    case "can-order":
      return {
        ...base,
        phase: "can-order",
        bucket: 2,
        eta: o.eta,
        confirmedAt: new Date(resolvedAtMs).toISOString(),
      };
    case "no-stock":
      return {
        ...base,
        phase: "no-stock",
        bucket: 3,
        confirmedAt: new Date(resolvedAtMs).toISOString(),
      };
    default:
      return { ...base, phase: terminalPhase(o), bucket: 4 };
  }
}

function snapshot(elapsed: number): PharmacyResult[] {
  const now = Date.now();
  return SCRIPT.map((call) => resultAt(elapsed, call, now));
}

function runTimeline(
  totalMs: number,
  onTick: (elapsed: number) => void,
  onDone: () => void,
): SearchHandle {
  const start = Date.now();
  const interval = window.setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed >= totalMs) {
      onTick(totalMs);
      window.clearInterval(interval);
      onDone();
      return;
    }
    onTick(elapsed);
  }, TICK_MS);

  return {
    cancel() {
      window.clearInterval(interval);
    },
  };
}

export function createSimulatedEngine(): SearchEngine {
  return {
    kind: "simulated",
    start(_request: SearchRequest, callbacks: SearchCallbacks): SearchHandle {
      callbacks.onUpdate(snapshot(0));
      return runTimeline(
        SCRIPT_END + RESOLVE_HOLD_MS,
        (elapsed) => callbacks.onUpdate(snapshot(elapsed)),
        () => callbacks.onComplete(snapshot(SCRIPT_END)),
      );
    },

    connect(_pharmacy: NominatedPharmacy, callbacks: ConnectCallbacks): SearchHandle {
      callbacks.onPhase("connecting");
      const timer = window.setTimeout(() => {
        callbacks.onPhase("connected");
      }, 3200);
      return {
        cancel() {
          window.clearTimeout(timer);
        },
      };
    },
  };
}

/** The patient's nominated pharmacy for the demo — deliberately not one of the
 *  searched pharmacies, so CONNECT reads as bridging back to "their" pharmacy.
 *  (ConnectFlow itself is parked — flagged decision F3.) */
export const DEMO_NOMINATED_PHARMACY: NominatedPharmacy = {
  name: "Rowlands Pharmacy",
  road: "Church Lane",
  phone: "020 7946 0090",
};
