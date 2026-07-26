/**
 * Full UI vocabulary for one pharmacy call, mirroring the backend state
 * machine (docs/architecture.md) through lib/domain/call-presentation.ts:
 * queued/dialing/asking are in-flight; in-stock/can-order/no-stock are the
 * three verdict kinds (buckets 1–3); unreached/unverified/expired are bucket 4
 * — NEVER stock verdicts, and styled so they can't be mistaken for one.
 */
export type CallPhase =
  | "queued"
  | "dialing"
  | "asking"
  | "in-stock"
  | "can-order"
  | "no-stock"
  | "unreached"
  | "unverified"
  | "expired";

export type RankBucket = 1 | 2 | 3 | 4;

export interface SearchRequest {
  medication: string;
  dose: string;
  /** Packs/boxes needed (1–20, schema-enforced). Partial stock renders
   *  against this: "1 box — you need 2". */
  quantity: number;
  postcode: string;
}

export interface PharmacyResult {
  id: string;
  name: string;
  road: string;
  address: string;
  distanceMiles: number;
  /** Compass bearing from the patient (degrees, 0 = north). Positions the map pin. */
  bearing: number;
  hours: string;
  phone: string;
  phase: CallPhase;
  /** Rank tier, set once terminal: 1 in stock · 2 orderable · 3 no stock · 4 couldn't reach/verify. */
  bucket?: RankBucket;
  /** Packs physically on the shelf (in-stock verdicts). */
  quantityAvailable?: number | null;
  /** Unit the pharmacist used ("boxes", "patches"…), from the verdict. */
  quantityUnit?: string | null;
  /** Supplier ETA for can-order verdicts ("tomorrow morning"). */
  eta?: string | null;
  /** When the verdict was confirmed by phone (ISO timestamp). */
  confirmedAt?: string | null;
}

/** The patient's currently nominated pharmacy — where their prescription lives
 *  today and the one Relay bridges them to during CONNECT. */
export interface NominatedPharmacy {
  name: string;
  road: string;
  phone: string;
}

export type ConnectPhase = "idle" | "connecting" | "connected";

export interface SearchHandle {
  /** Stop an in-flight run and release timers. Safe to call more than once. */
  cancel(): void;
}

export interface SearchCallbacks {
  onUpdate(pharmacies: PharmacyResult[]): void;
  /** Fired once when every pharmacy has resolved to in/out of stock. */
  onComplete(pharmacies: PharmacyResult[]): void;
}

export interface ConnectCallbacks {
  onPhase(phase: ConnectPhase): void;
}

/**
 * The seam the real product plugs into.
 *
 * Everything in the /search UI talks to a `SearchEngine`, never to the
 * simulation directly. Swapping the scripted engine (lib/search/simulated.ts)
 * for one backed by the live calling service — API polling, websockets, or
 * Twilio status callbacks — means implementing this interface and changing the
 * single line in app/search/page.tsx that constructs the engine. No UI change.
 */
export interface SearchEngine {
  /**
   * "simulated" = scripted demo data (UI shows a persistent demo-mode
   * disclosure); "live" = backed by real call rows. Never present simulated
   * output as live (codex review P1-1).
   */
  readonly kind: "simulated" | "live";
  /** DISCOVER + NOTIFY: place the calls and stream status until resolved. */
  start(request: SearchRequest, callbacks: SearchCallbacks): SearchHandle;
  /** CONNECT: bridge the patient to their nominated pharmacy. */
  connect(pharmacy: NominatedPharmacy, callbacks: ConnectCallbacks): SearchHandle;
}
