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
 * It replays a realistic round of parallel pharmacy calls on timers so the
 * /search UI can be demoed end to end with no backend. Replace this with an
 * engine backed by the live service (implementing the same SearchEngine
 * interface) once calling is ready — the UI won't change.
 */

export interface CallScript {
  id: string;
  name: string;
  road: string;
  address: string;
  distanceMiles: number;
  bearing: number;
  hours: string;
  phone: string;
  startAt: number;
  dialingMs: number;
  askingMs: number;
  inStock: boolean;
}

const TICK_MS = 100;
const RESOLVE_HOLD_MS = 700;

/** Nearest pharmacies "called" for the demo. Well Pharmacy (0.8mi) is the
 *  nearest with stock; Day Lewis (1.6mi) is a further backup that also has it.
 *  Timings keep ≤3 calls in dialing/asking at once — the demo must never show
 *  behavior the dispatch invariant forbids (CLAUDE.md: ≤3 in flight/search);
 *  tests/sim-concurrency.test.ts enforces this. */
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
    inStock: false,
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
    startAt: 450,
    dialingMs: 1500,
    askingMs: 1600,
    inStock: false,
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
    inStock: true,
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
    startAt: 3300, // waits for the first line to free up (≤3 in flight)
    dialingMs: 1600,
    askingMs: 1800,
    inStock: false,
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
    startAt: 3700, // waits for the second line (≤3 in flight)
    dialingMs: 1500,
    askingMs: 2000,
    inStock: true,
  },
];

/** Peak number of simultaneously active (dialing/asking) calls in a script —
 *  pure, so the ≤3 invariant is unit-testable. */
export function maxConcurrent(
  script: ReadonlyArray<Pick<CallScript, "startAt" | "dialingMs" | "askingMs">>,
): number {
  const events = script.flatMap((c) => [
    { at: c.startAt, delta: +1 },
    { at: c.startAt + c.dialingMs + c.askingMs, delta: -1 },
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

const SCRIPT_END = Math.max(
  ...SCRIPT.map((c) => c.startAt + c.dialingMs + c.askingMs),
);

function phaseAt(elapsed: number, call: CallScript): PharmacyResult["phase"] {
  if (elapsed < call.startAt) return "queued";
  const t = elapsed - call.startAt;
  if (t < call.dialingMs) return "dialing";
  if (t < call.dialingMs + call.askingMs) return "asking";
  return call.inStock ? "in-stock" : "out-of-stock";
}

function snapshot(elapsed: number): PharmacyResult[] {
  return SCRIPT.map((call) => ({
    id: call.id,
    name: call.name,
    road: call.road,
    address: call.address,
    distanceMiles: call.distanceMiles,
    bearing: call.bearing,
    hours: call.hours,
    phone: call.phone,
    phase: phaseAt(elapsed, call),
  }));
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
 *  searched pharmacies, so CONNECT reads as bridging back to "their" pharmacy. */
export const DEMO_NOMINATED_PHARMACY: NominatedPharmacy = {
  name: "Rowlands Pharmacy",
  road: "Church Lane",
  phone: "020 7946 0090",
};
