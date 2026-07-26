/**
 * DEV_TEST demo fixtures — the same 10-state board scripts/seed-fake-board.sql
 * seeds, as data the stub create_search command (Phase-1) inserts PER CALLER,
 * so every anonymous session owns its rows (RLS) with no shared pre-seed.
 * Pure data; timestamps are expressed as minutes-ago and materialized at
 * insert time. Phones are the Ofcom drama range — never real numbers.
 */

export const DEMO_MEDICATION = {
  id: "b0000000-0000-4000-8000-000000000001",
  name: "Creon",
  strength: "25,000 units",
  form: "gastro-resistant capsules",
  display: "Creon 25,000 gastro-resistant capsules",
} as const;

export interface FixturePharmacy {
  ods: string;
  name: string;
  address: string;
  postcode: string;
  phone: string;
  lat: number;
  lng: number;
  ownership_group: string;
  is_supermarket: boolean;
}

/** Ring central Birmingham (demo area is B5 per the runbook). 24/7 hours are
 *  applied at insert time — politeness rules stay on; the DATA is always open. */
export const FIXTURE_PHARMACIES: FixturePharmacy[] = [
  { ods: "FAKE01", name: "Wellfield Pharmacy", address: "42 High Street", postcode: "B5 4BU", phone: "+447700900001", lat: 52.4751, lng: -1.894, ownership_group: "independent", is_supermarket: false },
  { ods: "FAKE02", name: "St Martins Chemist", address: "8 Station Road", postcode: "B5 4TD", phone: "+447700900002", lat: 52.4772, lng: -1.8892, ownership_group: "independent", is_supermarket: false },
  { ods: "FAKE03", name: "Rea Valley Pharmacy", address: "119 London Road", postcode: "B5 6ND", phone: "+447700900003", lat: 52.47, lng: -1.8863, ownership_group: "reavalley", is_supermarket: false },
  { ods: "FAKE04", name: "Bullring Pharmacy", address: "3 Market Square", postcode: "B5 4QG", phone: "+447700900004", lat: 52.4776, lng: -1.8936, ownership_group: "reavalley", is_supermarket: false },
  { ods: "FAKE05", name: "Digbeth Chemist", address: "27 Bridge Street", postcode: "B5 6DY", phone: "+447700900005", lat: 52.4738, lng: -1.8811, ownership_group: "independent", is_supermarket: false },
  { ods: "FAKE06", name: "Moor St Pharmacy", address: "5 Moor Street", postcode: "B5 5BD", phone: "+447700900006", lat: 52.479, lng: -1.8919, ownership_group: "independent", is_supermarket: false },
  { ods: "FAKE07", name: "Camp Hill Pharmacy", address: "61 Camp Hill", postcode: "B5 5JN", phone: "+447700900007", lat: 52.4696, lng: -1.876, ownership_group: "independent", is_supermarket: false },
  { ods: "FAKE08", name: "Asda Pharmacy", address: "Barford Rd Estate", postcode: "B5 7RJ", phone: "+447700900008", lat: 52.4725, lng: -1.902, ownership_group: "asda", is_supermarket: true },
  { ods: "FAKE09", name: "Highgate Pharmacy", address: "14 Highgate Road", postcode: "B5 7XE", phone: "+447700900009", lat: 52.466, lng: -1.889, ownership_group: "independent", is_supermarket: false },
  { ods: "FAKE10", name: "Smallbrook Chemist", address: "90 Smallbrook Way", postcode: "B5 4EL", phone: "+447700900010", lat: 52.4762, lng: -1.8975, ownership_group: "independent", is_supermarket: false },
];

export interface FixtureCall {
  ods: string;
  status:
    | "queued"
    | "dialing"
    | "transcript_ready"
    | "verdict"
    | "unreached"
    | "wrong_location"
    | "expired";
  rank_bucket: 1 | 2 | 3 | 4 | null;
  location_confirmed: "yes" | "no" | null;
  verdict: {
    stock_status: "in_stock" | "orderable" | "out_of_stock";
    quantity_available: number | null;
    quantity_unit: string | null;
    eta: string | null;
    notes: string | null;
  } | null;
  /** minutes before "now" the verdict/end landed (null = still open). */
  verdictMinutesAgo: number | null;
  endedMinutesAgo: number | null;
  dialed: boolean;
}

/** One call per UI state — mirrors seed-fake-board.sql row for row. */
export const FIXTURE_CALLS: FixtureCall[] = [
  { ods: "FAKE09", status: "queued", rank_bucket: null, location_confirmed: null, verdict: null, verdictMinutesAgo: null, endedMinutesAgo: null, dialed: false },
  { ods: "FAKE06", status: "dialing", rank_bucket: null, location_confirmed: null, verdict: null, verdictMinutesAgo: null, endedMinutesAgo: null, dialed: true },
  { ods: "FAKE07", status: "transcript_ready", rank_bucket: null, location_confirmed: null, verdict: null, verdictMinutesAgo: null, endedMinutesAgo: 0.3, dialed: true },
  { ods: "FAKE01", status: "verdict", rank_bucket: 1, location_confirmed: "yes", verdict: { stock_status: "in_stock", quantity_available: 2, quantity_unit: "boxes", eta: null, notes: null }, verdictMinutesAgo: 4, endedMinutesAgo: 4, dialed: true },
  { ods: "FAKE02", status: "verdict", rank_bucket: 1, location_confirmed: "yes", verdict: { stock_status: "in_stock", quantity_available: 1, quantity_unit: "boxes", eta: null, notes: "last box on the shelf" }, verdictMinutesAgo: 3, endedMinutesAgo: 3, dialed: true },
  { ods: "FAKE03", status: "verdict", rank_bucket: 2, location_confirmed: "yes", verdict: { stock_status: "orderable", quantity_available: null, quantity_unit: null, eta: "tomorrow morning", notes: "orders before 5pm arrive next day" }, verdictMinutesAgo: 2, endedMinutesAgo: 2, dialed: true },
  { ods: "FAKE04", status: "verdict", rank_bucket: 3, location_confirmed: "yes", verdict: { stock_status: "out_of_stock", quantity_available: 0, quantity_unit: "boxes", eta: null, notes: "national shortage mentioned" }, verdictMinutesAgo: 1.5, endedMinutesAgo: 1.5, dialed: true },
  { ods: "FAKE05", status: "unreached", rank_bucket: 4, location_confirmed: null, verdict: null, verdictMinutesAgo: null, endedMinutesAgo: 2, dialed: true },
  { ods: "FAKE08", status: "wrong_location", rank_bucket: 4, location_confirmed: "no", verdict: null, verdictMinutesAgo: null, endedMinutesAgo: 1, dialed: true },
  { ods: "FAKE10", status: "expired", rank_bucket: 4, location_confirmed: null, verdict: null, verdictMinutesAgo: null, endedMinutesAgo: null, dialed: false },
];

/** 24/7 opening-hours jsonb (per-day session list, Europe/London wall clock). */
export const ALL_DAY_HOURS: Record<string, [string, string][]> = {
  mon: [["00:00", "24:00"]],
  tue: [["00:00", "24:00"]],
  wed: [["00:00", "24:00"]],
  thu: [["00:00", "24:00"]],
  fri: [["00:00", "24:00"]],
  sat: [["00:00", "24:00"]],
  sun: [["00:00", "24:00"]],
};
