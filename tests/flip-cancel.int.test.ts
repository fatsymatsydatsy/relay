import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dispatch } from "@/lib/commands/dispatch";
import type { OutboundCaller } from "@/lib/integrations/elevenlabs";

/** 4.5 flip.cancels — LOCAL stack, staged data across modes. */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
let SEQ = 0;
const ODS = (n: number) => `F45${RUN}${String(n).padStart(2, "0")}`;
const PHONE = () =>
  `+44770${String(Math.floor(Math.random() * 9000) + 1000)}${String(++SEQ).padStart(3, "0")}`;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ALL_WEEK = Object.fromEntries(DAYS.map((d) => [d, [["00:00", "24:00"]]]));

let db: SupabaseClient;
let stackUp = false;
let medId: string;
let pharmacySeq = 0;

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

async function mkPharmacy(): Promise<string> {
  pharmacySeq++;
  const ods = ODS(pharmacySeq);
  const { error } = await db.from("pharmacies").upsert(
    {
      ods_code: ods,
      name: `Flip Pharmacy ${pharmacySeq}`,
      address: `${pharmacySeq} Flip Road`,
      postcode: "F4 5ST",
      phone: PHONE(),
      lat: 62 + pharmacySeq * 0.001,
      lng: -0.5,
      hours: ALL_WEEK,
      ownership_group: "independent",
      is_supermarket: false,
      source: "dev_test",
    },
    { onConflict: "ods_code" },
  );
  if (error) throw new Error(error.message);
  return ods;
}

async function mkSearch(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db
    .from("searches")
    .insert({
      owner: crypto.randomUUID(),
      medication_id: medId,
      quantity_needed: 1,
      postcode: "F4 5ST",
      radius_km: 5,
      status: "active",
      deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id;
}

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: med, error } = await db
    .from("medications")
    .upsert(
      { name: "FlipMed", strength: RUN, form: "test", display: `FlipMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  medId = med!.id;
});

describe("flip.cancels", () => {
  it("staged non-terminal rows expire, their searches complete, DEMO boards survive", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // stale DEV_TEST search: one of each non-terminal state
    const devSearchId = await mkSearch();
    await db.from("calls").insert([
      { search_id: devSearchId, pharmacy_ods: await mkPharmacy(), status: "queued", is_bench: false, rank_score: 0.9 },
      { search_id: devSearchId, pharmacy_ods: await mkPharmacy(), status: "queued", is_bench: true, rank_score: 0.5 },
      { search_id: devSearchId, pharmacy_ods: await mkPharmacy(), status: "dialing", dial_mode: "DEV_TEST", claimed_at: new Date().toISOString(), is_bench: false },
      { search_id: devSearchId, pharmacy_ods: await mkPharmacy(), status: "transcript_ready", ended_at: new Date().toISOString(), transcript: { transcript: [] }, is_bench: false },
    ]);
    // a terminal verdict row that must SURVIVE untouched
    const verdictOds = await mkPharmacy();
    await db.from("calls").insert({
      search_id: devSearchId,
      pharmacy_ods: verdictOds,
      status: "verdict",
      rank_bucket: 1,
      location_confirmed: "yes",
      verdict: {
        stock_status: "in_stock",
        quantity_available: 1,
        quantity_unit: "boxes",
        quantity_meets_need: "yes",
        eta_days: null,
        eta_label: null,
        shortage_mentioned: false,
        outcome: "completed",
      },
      verdict_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      is_bench: false,
    });

    // a DEMO board mid-display
    const demoSearchId = await mkSearch({ dial_mode: "DEMO" });
    const demoQueuedOds = await mkPharmacy();
    await db.from("calls").insert({
      search_id: demoSearchId,
      pharmacy_ods: demoQueuedOds,
      status: "queued",
      is_bench: false,
    });

    const { data, error } = await db.rpc("flip_cancel_non_terminal", {
      p_at: new Date().toISOString(),
    });
    expect(error).toBeNull();
    const result = (data ?? [])[0] as { expired_calls: number; settled_searches: number };
    expect(result.expired_calls).toBeGreaterThanOrEqual(4);
    expect(result.settled_searches).toBeGreaterThanOrEqual(1);

    const { data: devRows } = await db
      .from("calls")
      .select("status, pharmacy_ods")
      .eq("search_id", devSearchId);
    for (const row of devRows ?? []) {
      if (row.pharmacy_ods === verdictOds) expect(row.status).toBe("verdict");
      else expect(row.status).toBe("expired");
    }
    const { data: devSearch } = await db
      .from("searches")
      .select("status, settled_at")
      .eq("id", devSearchId)
      .single();
    expect(devSearch?.status).toBe("complete");
    expect(devSearch?.settled_at).not.toBeNull();

    // the demo board is untouched — still active, still queued
    const { data: demoSearch } = await db
      .from("searches")
      .select("status")
      .eq("id", demoSearchId)
      .single();
    expect(demoSearch?.status).toBe("active");
    const { data: demoRows } = await db
      .from("calls")
      .select("status")
      .eq("search_id", demoSearchId);
    expect(demoRows?.[0]?.status).toBe("queued");
  });

  it("after the flip sweep, a REAL claim finds nothing to dial (verified-only stands)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const okCaller: OutboundCaller = async () => ({
      ok: true,
      conversationId: `conv_f45_${crypto.randomUUID()}`,
      callSid: null,
    });
    const res = await dispatch({
      db,
      caller: okCaller,
      dialMode: "REAL",
      devTestNumbers: [],
      globalCap: 8,
    });
    // every dev_test row is either terminal or mode-gated; no verified REAL
    // pharmacies exist in this fixture set — the claim must come up empty
    expect(res.claimed).toBe(0);
  });
});
