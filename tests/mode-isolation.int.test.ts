import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSearch } from "@/lib/commands/create_search";

/**
 * mode.isolation (3.7, audit P1-1) — LOCAL stack.
 *
 * The pool, the verdict cache, and the settle path are mode-scoped inside
 * create_search itself: a REAL search must never rank a dev_test pharmacy,
 * wait on one, or wear one's verdict. (The claim-side half — DEMO exclusion,
 * s.dial_mode gating — is proven in claim-hardening.int.test.ts.)
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Mon 26 Jan 2026 10:00 UTC == 10:00 London (GMT) — every fixture is open.
const DAY = new Date("2026-01-26T10:00:00Z");
const minutesBefore = (m: number) => new Date(DAY.getTime() - m * 60_000).toISOString();

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const ODS = (kind: string, n: number) => `M37${RUN}${kind}${n}`;
const ORIGIN = { lat: 46 + Math.random() * 1.5, lng: 5 + Math.random() * 1.5 };
const fakeGeocode = async () => ORIGIN;

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ALL_WEEK = Object.fromEntries(DAYS.map((d) => [d, [["00:00", "24:00"]]]));

const MED = `IsolationMed-${RUN}`;
const MED2 = `IsolationMed2-${RUN}`;

let db: SupabaseClient;
let stackUp = false;

async function localStackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_URL}/rest/v1/`, {
      headers: { apikey: LOCAL_SERVICE_KEY },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function pharmacy(ods: string, n: number, overrides: Record<string, unknown> = {}) {
  return {
    ods_code: ods,
    name: `Isolation Pharmacy ${ods}`,
    address: `${n} Isolation Way`,
    postcode: "M3 7ST",
    phone: `+44770${String(Math.floor(Math.random() * 9000) + 1000)}9${String(n).padStart(2, "0")}`,
    lat: ORIGIN.lat + n * 0.001,
    lng: ORIGIN.lng,
    hours: ALL_WEEK,
    ownership_group: "independent",
    is_supermarket: false,
    ...overrides,
  };
}

async function medicationId(display: string): Promise<string> {
  const { data, error } = await db
    .from("medications")
    .upsert(
      { name: display, strength: "test", form: "test", display },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id;
}

/** a legacy-style search + fresh verdict call, inserted directly (bypasses
 *  create_search on purpose — this is how cross-mode data already exists) */
async function seedVerdict(opts: {
  medId: string;
  dialMode: string;
  ods: string;
  verdictMinutesAgo: number;
}): Promise<string> {
  const { data: search, error: sErr } = await db
    .from("searches")
    .insert({
      owner: crypto.randomUUID(),
      medication_id: opts.medId,
      quantity_needed: 1,
      postcode: "M3 7ST",
      radius_km: 5,
      status: "complete",
      dial_mode: opts.dialMode,
      created_at: minutesBefore(opts.verdictMinutesAgo + 2),
      deadline_at: minutesBefore(opts.verdictMinutesAgo - 18),
      settled_at: minutesBefore(opts.verdictMinutesAgo),
    })
    .select("id")
    .single();
  if (sErr) throw new Error(sErr.message);
  const { data: call, error: cErr } = await db
    .from("calls")
    .insert({
      search_id: search!.id,
      pharmacy_ods: opts.ods,
      status: "verdict",
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
      verdict_at: minutesBefore(opts.verdictMinutesAgo),
      ended_at: minutesBefore(opts.verdictMinutesAgo),
    })
    .select("id")
    .single();
  if (cErr) throw new Error(cErr.message);
  return call!.id;
}

const input = (medication: string) => ({
  owner: crypto.randomUUID(),
  medication,
  dose: "",
  quantity: 1,
  postcode: "M3 7ST",
});

const deps = (dialMode: "DEV_TEST" | "REAL") => ({
  db,
  geocode: fakeGeocode,
  now: DAY,
  dialMode,
});

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });

  const rows = [
    // three verified REAL pharmacies
    pharmacy(ODS("R", 1), 1, { verified: true, source: "manual" }),
    pharmacy(ODS("R", 2), 2, { verified: true, source: "manual" }),
    pharmacy(ODS("R", 3), 3, { verified: true, source: "manual" }),
    // three dev_test fakes IN THE SAME RADIUS (the audit's exact hazard)
    pharmacy(ODS("D", 1), 4, { verified: false, source: "dev_test" }),
    pharmacy(ODS("D", 2), 5, { verified: false, source: "dev_test" }),
    pharmacy(ODS("D", 3), 6, { verified: false, source: "dev_test" }),
    // one unverified real pharmacy — eligible in NEITHER mode
    pharmacy(ODS("U", 1), 7, { verified: false, source: "manual" }),
  ];
  const { error } = await db.from("pharmacies").upsert(rows, { onConflict: "ods_code" });
  if (error) throw new Error(error.message);
});

describe("mode.isolation — create_search is mode-scoped end-to-end", () => {
  it("a REAL search targets ONLY verified real pharmacies", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const res = await createSearch(input(MED), deps("REAL"));
    const { data: rows } = await db
      .from("calls")
      .select("pharmacy_ods")
      .eq("search_id", res.searchId);
    const odses = (rows ?? []).map((r) => r.pharmacy_ods).sort();
    expect(odses).toEqual([ODS("R", 1), ODS("R", 2), ODS("R", 3)].sort());

    const { data: search } = await db
      .from("searches")
      .select("dial_mode")
      .eq("id", res.searchId)
      .single();
    expect(search?.dial_mode).toBe("REAL");
  });

  it("a DEV_TEST search is the mirror image — fakes only", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const res = await createSearch(input(MED), deps("DEV_TEST"));
    const { data: rows } = await db
      .from("calls")
      .select("pharmacy_ods")
      .eq("search_id", res.searchId);
    const odses = (rows ?? []).map((r) => r.pharmacy_ods).sort();
    expect(odses).toEqual([ODS("D", 1), ODS("D", 2), ODS("D", 3)].sort());
  });

  it("a cross-mode verdict is NEVER cache-copied; a same-mode one is", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);
    const medId = await medicationId(MED);

    // same-mode REAL verdict, and a NEWER cross-mode DEV_TEST verdict on the
    // same pharmacy: the copy must take the REAL one and ignore the newer fake
    const realVerdictId = await seedVerdict({
      medId,
      dialMode: "REAL",
      ods: ODS("R", 1),
      verdictMinutesAgo: 5,
    });
    await seedVerdict({
      medId,
      dialMode: "DEV_TEST",
      ods: ODS("R", 1),
      verdictMinutesAgo: 2,
    });

    const res = await createSearch(input(MED), deps("REAL"));
    expect(res.cachedCopies).toBe(1);

    const { data: copied } = await db
      .from("calls")
      .select("pharmacy_ods, copied_from_call_id, status")
      .eq("search_id", res.searchId)
      .eq("status", "verdict");
    expect(copied).toHaveLength(1);
    expect(copied![0].pharmacy_ods).toBe(ODS("R", 1));
    expect(copied![0].copied_from_call_id).toBe(realVerdictId); // not the newer fake
  });

  it("an all-cached search settles immediately (audit P2-1)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);
    const med2Id = await medicationId(MED2);

    for (const n of [1, 2, 3]) {
      await seedVerdict({
        medId: med2Id,
        dialMode: "REAL",
        ods: ODS("R", n),
        verdictMinutesAgo: 4 + n,
      });
    }

    const res = await createSearch(input(MED2), deps("REAL"));
    expect(res.cachedCopies).toBe(3);
    expect(res.queued).toBe(0);

    const { data: search } = await db
      .from("searches")
      .select("status, settled_at")
      .eq("id", res.searchId)
      .single();
    expect(search?.status).toBe("complete"); // no dial, no webhook, no zombie
    expect(search?.settled_at).not.toBeNull();
  });
});
