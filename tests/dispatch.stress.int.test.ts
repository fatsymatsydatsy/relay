import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dispatch } from "@/lib/commands/dispatch";
import type { OutboundCaller } from "@/lib/integrations/elevenlabs";

/**
 * dispatch.stress (3.2, designed-out bug #1) — LOCAL stack only.
 *
 * dial_log is append-only by design (no cleanup possible, and the 1-hour rule
 * would block re-runs), so every run uses fresh namespaced pharmacies/phones;
 * `supabase db reset` is the local garbage collector.
 *
 * Hermetic global cap: the claim counts EVERY dialing row in the database
 * (that's the invariant), so setup expires all non-fixture in-flight rows —
 * including the seeded demo board. Re-run scripts/seed-fake-board.sql to
 * restore the demo afterwards.
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const STRESS_LAT = 55 + Math.random() * 1.5;
const STRESS_LNG = 1 + Math.random() * 1.5; // North Sea — nowhere near anyone
const ODS = (n: number) => `S32${RUN}${String(n).padStart(2, "0")}`;
const PHONE = (n: number) =>
  `+4477012${String(Math.floor(Math.random() * 90) + 10)}${String(n).padStart(3, "0")}`;
const TEAM = ["+447700900901", "+447700900902"];

const ALL_WEEK = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["00:00", "24:00"]]]),
);

const okCaller: OutboundCaller = async () => ({
  ok: true,
  conversationId: `conv_stress_${crypto.randomUUID()}`,
  callSid: null,
});
const definiteFail: OutboundCaller = async () => ({
  ok: false,
  definite: true,
  detail: "over capacity",
});
const ambiguousFail: OutboundCaller = async () => ({
  ok: false,
  definite: false,
  detail: "socket timeout",
});

let db: SupabaseClient;
let stackUp = false;
let searchIds: string[] = [];
let sharedPhone: string;

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

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: med, error: medErr } = await db
    .from("medications")
    .upsert(
      { name: "StressMed", strength: RUN, form: "test", display: `StressMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (medErr) throw new Error(medErr.message);

  // 31 pharmacies: 30 unique + one SHARED number scenario below; +1 closed
  const pharmacies = Array.from({ length: 30 }, (_, i) =>
    pharmacyRow(i + 1, PHONE(i + 1)),
  );
  sharedPhone = PHONE(77);
  pharmacies.push(pharmacyRow(31, sharedPhone)); // queued by TWO searches
  pharmacies.push({ ...pharmacyRow(32, PHONE(32)), hours: { mon: [["09:00", "10:00"]] } }); // effectively closed
  const { error: phErr } = await db.from("pharmacies").upsert(pharmacies, { onConflict: "ods_code" });
  if (phErr) throw new Error(phErr.message);

  // 3 searches × 10 queued calls → per-search cap (3) and global cap (8) both bind
  searchIds = [];
  for (let s = 0; s < 3; s++) {
    const { data: search, error: sErr } = await db
      .from("searches")
      .insert({
        owner: crypto.randomUUID(),
        medication_id: med!.id,
        quantity_needed: 1,
        postcode: "S3 2ST",
        radius_km: 5,
        status: "active",
        deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (sErr) throw new Error(sErr.message);
    searchIds.push(search!.id);

    const calls = Array.from({ length: 10 }, (_, i) => ({
      search_id: search!.id,
      pharmacy_ods: ODS(s * 10 + i + 1),
      status: "queued" as const,
      rank_score: 1 - i * 0.05,
      is_bench: false,
    }));
    // searches 0 and 1 BOTH queue the shared-number pharmacy
    if (s < 2) {
      calls.push({
        search_id: search!.id,
        pharmacy_ods: ODS(31),
        status: "queued" as const,
        rank_score: 0.99, // ranked high so both searches want it early
        is_bench: false,
      });
    }
    // the closed pharmacy is queued too — must never be claimed
    calls.push({
      search_id: search!.id,
      pharmacy_ods: ODS(32),
      status: "queued" as const,
      rank_score: 0.98,
      is_bench: false,
    });
    const { error: cErr } = await db.from("calls").insert(calls);
    if (cErr) throw new Error(cErr.message);
  }

  // hermetic: expire every foreign non-terminal call so OUR fixtures own the
  // whole global cap (verdict stays null on these rows, so the
  // failures_carry_no_stock constraint is satisfied)
  const { data: foreign } = await db
    .from("calls")
    .select("id, search_id")
    .in("status", ["queued", "dialing", "transcript_ready"]);
  const foreignIds = (foreign ?? [])
    .filter((c) => !searchIds.includes(c.search_id))
    .map((c) => c.id);
  if (foreignIds.length) {
    const { error: exErr } = await db
      .from("calls")
      .update({ status: "expired", rank_bucket: 4 })
      .in("id", foreignIds);
    if (exErr) throw new Error(`expire foreign: ${exErr.message}`);
  }
});

function pharmacyRow(n: number, phone: string) {
  return {
    ods_code: ODS(n),
    name: `Stress Pharmacy ${n}`,
    address: `${n} Stress Street`,
    postcode: "S3 2ST",
    phone,
    // per-run random geography — same reason as create-search's ORIGIN:
    // no other test (or stale prior run) may land inside anyone's radius
    lat: STRESS_LAT + n * 0.001,
    lng: STRESS_LNG,
    hours: ALL_WEEK,
    ownership_group: "independent",
    is_supermarket: false,
    source: "dev_test",
  };
}

describe("dispatch.stress — 20 concurrent invocations never break the caps", () => {
  it("caps hold: ≤8 global, ≤3 per search, one dial per number, closed never dialed", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        dispatch({
          db,
          caller: okCaller,
          dialMode: "DEV_TEST",
          devTestNumbers: TEAM,
          globalCap: 8,
        }),
      ),
    );

    const totalClaimed = results.reduce((n, r) => n + r.claimed, 0);
    expect(totalClaimed).toBe(8); // exactly the global cap, not one more

    const { data: dialing } = await db
      .from("calls")
      .select("id, search_id, pharmacy_ods, conversation_id, resolved_number, status")
      .in("search_id", searchIds)
      .eq("status", "dialing");
    expect(dialing).toHaveLength(8);

    // per-search cap
    for (const searchId of searchIds) {
      const inFlight = (dialing ?? []).filter((c) => c.search_id === searchId);
      expect(inFlight.length).toBeLessThanOrEqual(3);
    }

    // every posted call got a conversation and a TEAM number (DEV_TEST reroute)
    for (const c of dialing ?? []) {
      expect(c.conversation_id).toMatch(/^conv_stress_/);
      expect(TEAM).toContain(c.resolved_number);
    }

    // one dial per phone number: the shared-number pharmacy was claimed at
    // most once across the two searches that queued it
    const sharedDials = (dialing ?? []).filter((c) => c.pharmacy_ods === ODS(31));
    expect(sharedDials.length).toBeLessThanOrEqual(1);
    const { data: sharedLog } = await db
      .from("dial_log")
      .select("id, outcome")
      .eq("phone", sharedPhone)
      .in("outcome", ["reserved", "connected"]);
    expect((sharedLog ?? []).length).toBeLessThanOrEqual(1);

    // the closed pharmacy is untouched in every search
    const { data: closedRows } = await db
      .from("calls")
      .select("status")
      .in("search_id", searchIds)
      .eq("pharmacy_ods", ODS(32));
    expect((closedRows ?? []).every((c) => c.status === "queued")).toBe(true);

    // dial_log lifecycle: every connected claim is marked connected
    const { data: log } = await db
      .from("dial_log")
      .select("outcome, call_id")
      .in("call_id", (dialing ?? []).map((c) => c.id));
    expect(log).toHaveLength(8);
    expect((log ?? []).every((l) => l.outcome === "connected")).toBe(true);
  });

  it("a definite rejection frees the number; an ambiguous timeout does not", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // free a line first: complete one dialing call so capacity exists
    const { data: one } = await db
      .from("calls")
      .select("id")
      .in("search_id", searchIds)
      .eq("status", "dialing")
      .limit(2);
    for (const c of one ?? []) {
      await db
        .from("calls")
        .update({ status: "unreached", rank_bucket: 4, ended_at: new Date().toISOString() })
        .eq("id", c.id);
    }

    // definite rejection: claimed row returns to queued, dial_log freed
    const rejected = await dispatch({
      db,
      caller: definiteFail,
      dialMode: "DEV_TEST",
      devTestNumbers: TEAM,
      globalCap: 8,
    });
    expect(rejected.claimed).toBeGreaterThan(0);
    expect(rejected.freed).toBe(rejected.claimed);
    expect(rejected.posted).toBe(0);

    const { data: freedLog } = await db
      .from("dial_log")
      .select("outcome")
      .eq("outcome", "freed");
    expect((freedLog ?? []).length).toBeGreaterThan(0);

    // ambiguous: rows STAY dialing, log stays reserved, anomaly recorded
    const ambiguous = await dispatch({
      db,
      caller: ambiguousFail,
      dialMode: "DEV_TEST",
      devTestNumbers: TEAM,
      globalCap: 8,
    });
    expect(ambiguous.claimed).toBeGreaterThan(0);
    expect(ambiguous.ambiguous).toBe(ambiguous.claimed);

    const { data: stillDialing } = await db
      .from("calls")
      .select("id")
      .in("search_id", searchIds)
      .eq("status", "dialing")
      .is("conversation_id", null);
    expect((stillDialing ?? []).length).toBeGreaterThanOrEqual(ambiguous.claimed);

    const { data: anomalies } = await db
      .from("anomalies")
      .select("kind")
      .eq("kind", "dial_post_ambiguous");
    expect((anomalies ?? []).length).toBeGreaterThan(0);
  });

  it("the kill switch claims nothing", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);
    const result = await dispatch({
      db,
      caller: okCaller,
      dialMode: "DEV_TEST",
      devTestNumbers: TEAM,
      globalCap: 8,
      dialingEnabled: false,
    });
    expect(result).toEqual({ claimed: 0, posted: 0, freed: 0, ambiguous: 0 });
  });
});
