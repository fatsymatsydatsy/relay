import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSearch } from "@/lib/commands/create_search";
import type { OpeningHours } from "@/lib/domain/opening-hours";

/**
 * 3.1 integration test — runs against the LOCAL supabase stack (destructive
 * tests never touch cloud; see docs/operations.md). Skips itself when the
 * stack is down. Keys are the supabase-CLI local demo constants (public,
 * shared by every local dev stack — not secrets).
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Mon 26 Jan 2026 10:00 UTC == 10:00 London (GMT).
const DAY = new Date("2026-01-26T10:00:00Z");
const NIGHT = new Date("2026-01-26T03:00:00Z");
// Per-run random geography: fixture pharmacies from other tests (and stale
// rows from previous runs — dial_log makes cleanup impossible) must never
// fall inside this run's radius.
const ORIGIN = {
  lat: 50 + Math.random() * 1.5,
  lng: -4 - Math.random() * 1.5,
};
const fakeGeocode = async () => ORIGIN;

const NINE_TO_SIX: OpeningHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [["09:00", "18:00"]]]),
);
const ALL_WEEK: OpeningHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["00:00", "24:00"]]]),
);

const ODS = (n: number) => `T31X${String(n).padStart(2, "0")}`;
const OWNER = crypto.randomUUID();
const MED = "IntTest-Creon-31";

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

function pharmacy(
  n: number,
  latOffset: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    ods_code: ODS(n),
    name: `Int Test Pharmacy ${n}`,
    address: `${n} Test Street`,
    postcode: "T3 1ST",
    phone: `+4477009002${String(n).padStart(2, "0")}`,
    lat: ORIGIN.lat + latOffset,
    lng: ORIGIN.lng,
    hours: ALL_WEEK,
    ownership_group: "independent",
    is_supermarket: false,
    source: "dev_test",
    ...overrides,
  };
}

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // pool: 5 independents · 2 same-chain · 1 supermarket · 1 closed at night
  // only · 1 closing-soon at DAY (10:40 close) — all within ~2km
  const pool = [
    pharmacy(1, 0.001),
    pharmacy(2, 0.002),
    pharmacy(3, 0.003),
    pharmacy(4, 0.004),
    pharmacy(5, 0.005),
    pharmacy(6, 0.006, { ownership_group: "intchain" }),
    pharmacy(7, 0.007, { ownership_group: "intchain" }),
    pharmacy(8, 0.008, { ownership_group: "intchain" }), // 3rd chain member — must never be picked with the others
    pharmacy(9, 0.009, { ownership_group: "intmarket", is_supermarket: true }),
    pharmacy(10, 0.01, { hours: NINE_TO_SIX }), // closed at NIGHT
    pharmacy(11, 0.011, { hours: { mon: [["08:00", "10:40"]] } }), // closing soon at DAY
    // isolated 2.2km north: the only pharmacy near the night-test origin,
    // and closed at 03:00 — makes the zero-open path deterministic
    pharmacy(12, 0.02, { hours: NINE_TO_SIX }),
  ];
  const { error } = await db
    .from("pharmacies")
    .upsert(pool, { onConflict: "ods_code" });
  if (error) throw new Error(`pool upsert: ${error.message}`);
});

afterAll(async () => {
  if (!stackUp) return;
  const ods = Array.from({ length: 12 }, (_, i) => ODS(i + 1));
  const { data: searches } = await db
    .from("searches")
    .select("id")
    .eq("owner", OWNER);
  const ids = (searches ?? []).map((s) => s.id);
  if (ids.length) {
    await db.from("calls").delete().in("search_id", ids);
    await db.from("searches").delete().in("id", ids);
  }
  await db.from("calls").delete().in("pharmacy_ods", ods); // cache fixtures
  await db.from("pharmacies").delete().in("ods_code", ods);
  await db.from("medications").delete().like("display", `${MED}%`);
});

describe("create_search integration (local stack)", () => {
  it("queues the right mix: 6 targets, ≤2 per chain, supermarket in, bench behind", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const result = await createSearch(
      { owner: OWNER, medication: MED, dose: "25,000", quantity: 2, postcode: "T3 1ST" },
      { db, geocode: fakeGeocode, now: DAY },
    );

    expect(result.zeroOpen).toBe(false);
    expect(result.queued).toBe(6);

    const { data: calls } = await db
      .from("calls")
      .select("pharmacy_ods, status, is_bench, rank_score")
      .eq("search_id", result.searchId);
    const targets = (calls ?? []).filter((c) => !c.is_bench);
    const bench = (calls ?? []).filter((c) => c.is_bench);

    expect(targets).toHaveLength(6);
    expect(bench.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.status === "queued")).toBe(true);
    expect(targets.every((t) => t.rank_score !== null)).toBe(true);

    // chain cap: at most 2 of the 3 intchain branches
    const chainPicked = targets.filter((t) =>
      [ODS(6), ODS(7), ODS(8)].includes(t.pharmacy_ods),
    );
    expect(chainPicked.length).toBeLessThanOrEqual(2);

    // the closing-soon pharmacy is never dialed, not even as bench
    const allOds = (calls ?? []).map((c) => c.pharmacy_ods);
    expect(allOds).not.toContain(ODS(11));

    // supermarket quota
    expect(targets.map((t) => t.pharmacy_ods)).toContain(ODS(9));
  });

  it("cache-copy: a <1h verdict is copied with its ORIGINAL timestamp, not re-dialed", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // manufacture a prior verdict 30 min ago for pharmacy 1 on the same med
    const { data: med } = await db
      .from("medications")
      .select("id")
      .eq("display", `${MED} 25,000`)
      .single();
    const { data: priorSearch } = await db
      .from("searches")
      .insert({
        owner: OWNER,
        medication_id: med!.id,
        quantity_needed: 1,
        postcode: "T3 1ST",
        radius_km: 5,
        status: "complete",
        deadline_at: new Date(DAY.getTime()).toISOString(),
        created_at: new Date(DAY.getTime() - 40 * 60_000).toISOString(),
        settled_at: new Date(DAY.getTime() - 30 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    const originalVerdictAt = new Date(DAY.getTime() - 30 * 60_000).toISOString();
    const { data: priorCall, error: priorErr } = await db
      .from("calls")
      .insert({
        search_id: priorSearch!.id,
        pharmacy_ods: ODS(1),
        status: "verdict",
        rank_bucket: 1,
        location_confirmed: "yes",
        verdict: { stock_status: "in_stock", quantity_available: 2, quantity_unit: "boxes" },
        verdict_at: originalVerdictAt,
        ended_at: originalVerdictAt,
      })
      .select("id")
      .single();
    expect(priorErr).toBeNull();

    const result = await createSearch(
      { owner: OWNER, medication: MED, dose: "25,000", quantity: 2, postcode: "T3 1ST" },
      { db, geocode: fakeGeocode, now: DAY },
    );
    expect(result.cachedCopies).toBeGreaterThanOrEqual(1);

    const { data: copied } = await db
      .from("calls")
      .select("status, verdict_at, copied_from_call_id, rank_bucket")
      .eq("search_id", result.searchId)
      .eq("pharmacy_ods", ODS(1))
      .single();
    expect(copied?.status).toBe("verdict");
    expect(copied?.copied_from_call_id).toBe(priorCall!.id);
    expect(new Date(copied!.verdict_at!).getTime()).toBe(
      new Date(originalVerdictAt).getTime(),
    );
    expect(copied?.rank_bucket).toBe(1);
  });

  it("night simulation: zero open pharmacies → complete immediately with next openings", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // origin next to the isolated pharmacy 12; the minimum legal radius
    // (0.5km — schema CHECK) reaches nothing else
    const nightGeocode = async () => ({ lat: ORIGIN.lat + 0.02, lng: ORIGIN.lng });
    const result = await createSearch(
      { owner: OWNER, medication: MED, dose: "25,000", quantity: 1, postcode: "T3 1ST" },
      { db, geocode: nightGeocode, now: NIGHT, radiusKm: 0.5 },
    );

    expect(result.zeroOpen).toBe(true);
    expect(result.queued).toBe(0);
    expect(result.nextOpenings.length).toBeGreaterThan(0);
    expect(result.nextOpenings[0]).toMatchObject({ day: "mon", time: "09:00" });

    const { data: search } = await db
      .from("searches")
      .select("status, settled_at")
      .eq("id", result.searchId)
      .single();
    expect(search?.status).toBe("complete");
    expect(search?.settled_at).not.toBeNull();
  });
});
