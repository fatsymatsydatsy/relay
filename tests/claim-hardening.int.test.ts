import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dispatch } from "@/lib/commands/dispatch";
import { londonClock } from "@/lib/domain/opening-hours";
import type { OutboundCaller } from "@/lib/integrations/elevenlabs";

/**
 * 3.7 claim-side hardening (audit P1-1/P1-2/P1-5/P1-6/P2-1) — LOCAL stack.
 *
 * Same conventions as dispatch.stress: namespaced per-run fixtures, random
 * phones (dial_log is append-only), and each test starts by expiring every
 * in-flight call in the database so global-cap assertions are exact
 * (fileParallelism is off — no other test file runs concurrently).
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
let SEQ = 0;
const ODS = (n: number) => `H37${RUN}${String(n).padStart(2, "0")}`;
const PHONE = () =>
  `+44770${String(Math.floor(Math.random() * 9000) + 1000)}${String(++SEQ).padStart(3, "0")}`;
const TEAM = ["+447700900901", "+447700900902"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ALL_WEEK = Object.fromEntries(DAYS.map((d) => [d, [["00:00", "24:00"]]]));

const okCaller: OutboundCaller = async () => ({
  ok: true,
  conversationId: `conv_h37_${crypto.randomUUID()}`,
  callSid: null,
});

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

/** hermetic capacity AND candidates: expire every claimable/in-flight row
 *  outside this test's own searches — leftover queued rows from the demo seed
 *  or earlier runs must never satisfy (or steal) a claim assertion */
async function expireForeign(keepSearchIds: string[]) {
  const { data } = await db
    .from("calls")
    .select("id, search_id")
    .in("status", ["queued", "dialing", "transcript_ready"]);
  const ids = (data ?? [])
    .filter((c) => !keepSearchIds.includes(c.search_id))
    .map((c) => c.id);
  if (ids.length) {
    await db.from("calls").update({ status: "expired", rank_bucket: 4 }).in("id", ids);
  }
}

async function mkPharmacies(
  count: number,
  overrides: Record<string, unknown> = {},
): Promise<{ ods_code: string; phone: string }[]> {
  const rows = Array.from({ length: count }, () => {
    pharmacySeq++;
    return {
      ods_code: ODS(pharmacySeq),
      name: `Hardening Pharmacy ${pharmacySeq}`,
      address: `${pharmacySeq} Hardening Row`,
      postcode: "H3 7ST",
      phone: PHONE(),
      lat: 58 + pharmacySeq * 0.001, // far North Sea — outside every radius
      lng: 2.8,
      hours: ALL_WEEK,
      ownership_group: "independent",
      is_supermarket: false,
      source: "dev_test",
      ...overrides,
    };
  });
  const { error } = await db.from("pharmacies").upsert(rows, { onConflict: "ods_code" });
  if (error) throw new Error(`pharmacies: ${error.message}`);
  return rows.map((r) => ({ ods_code: r.ods_code, phone: r.phone as string }));
}

async function mkSearch(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db
    .from("searches")
    .insert({
      owner: crypto.randomUUID(),
      medication_id: medId,
      quantity_needed: 1,
      postcode: "H3 7ST",
      radius_km: 5,
      status: "active",
      deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`search: ${error.message}`);
  return data!.id;
}

async function mkQueued(
  searchId: string,
  ods: string,
  rank = 0.5,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await db
    .from("calls")
    .insert({
      search_id: searchId,
      pharmacy_ods: ods,
      status: "queued",
      rank_score: rank,
      is_bench: false,
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw new Error(`call: ${error.message}`);
  return data!.id;
}

const claim = (caps: { globalCap?: number } = {}) =>
  dispatch({
    db,
    caller: okCaller,
    dialMode: "DEV_TEST",
    devTestNumbers: TEAM,
    globalCap: caps.globalCap ?? 8,
  });

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: med, error } = await db
    .from("medications")
    .upsert(
      { name: "HardeningMed", strength: RUN, form: "test", display: `HardeningMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  medId = med!.id;
});

describe("3.7 claim hardening", () => {
  it("claim.stay-open — closing-soon and junk-hours pharmacies are never claimed", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const clock = londonClock(new Date());
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const openMin = Math.max(0, clock.minutes - 60);
    // open RIGHT NOW, but with under 60 minutes left (24:00-capped near midnight)
    const closingSession =
      clock.minutes + 30 >= 1440
        ? [fmt(openMin), "24:00"]
        : [fmt(openMin), fmt(clock.minutes + 30)];
    const [closing] = await mkPharmacies(1, { hours: { [clock.day]: [closingSession] } });
    const [junk] = await mkPharmacies(1, {
      hours: Object.fromEntries(DAYS.map((d) => [d, [["09:00", "99:00"]]])),
    });
    const [control] = await mkPharmacies(1);

    const searchId = await mkSearch();
    await mkQueued(searchId, closing.ods_code, 0.9); // ranked ABOVE the control
    await mkQueued(searchId, junk.ods_code, 0.8);
    await mkQueued(searchId, control.ods_code, 0.1);
    await expireForeign([searchId]);

    const res = await claim();
    expect(res.claimed).toBe(1); // only the control passes the stay-open horizon

    const { data: rows } = await db
      .from("calls")
      .select("pharmacy_ods, status")
      .eq("search_id", searchId);
    const byOds = new Map((rows ?? []).map((r) => [r.pharmacy_ods, r.status]));
    expect(byOds.get(closing.ods_code)).toBe("queued");
    expect(byOds.get(junk.ods_code)).toBe("queued");
    expect(byOds.get(control.ods_code)).toBe("dialing");
  });

  it("caps.clamped — a misconfigured cap of 20 still stops at 8 (audit P1-6)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // 4 searches × 3 candidates: 12 claimable, per-search cap binds at 3
    const searchIds: string[] = [];
    for (let s = 0; s < 4; s++) {
      const searchId = await mkSearch();
      searchIds.push(searchId);
      const pharmacies = await mkPharmacies(3);
      for (const p of pharmacies) await mkQueued(searchId, p.ods_code);
    }
    await expireForeign(searchIds);

    const res = await claim({ globalCap: 20 });
    expect(res.claimed).toBe(8); // TS clamp + DB least() — never the configured 20

    const { data: dialing } = await db.from("calls").select("id").eq("status", "dialing");
    expect(dialing).toHaveLength(8);
  });

  it("the 12-attempt politeness budget stops a dead-end streak (audit P1-5)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    // 12 attempts already spent: terminal calls whose dial_log rows are the budget
    const spent = await mkPharmacies(12);
    for (const p of spent) {
      const { data: call, error } = await db
        .from("calls")
        .insert({
          search_id: searchId,
          pharmacy_ods: p.ods_code,
          status: "unreached",
          rank_bucket: 4,
          is_bench: false,
          ended_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const { error: dlError } = await db.from("dial_log").insert({
        phone: p.phone,
        medication_id: medId,
        call_id: call!.id,
        outcome: "reserved",
        dialed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      });
      if (dlError) throw new Error(dlError.message);
    }
    const [fresh] = await mkPharmacies(1);
    const freshCallId = await mkQueued(searchId, fresh.ods_code, 0.9);
    await expireForeign([searchId]);

    const res = await claim();
    expect(res.claimed).toBe(0); // the 13th attempt never happens

    const { data: still } = await db.from("calls").select("status").eq("id", freshCallId).single();
    expect(still?.status).toBe("queued");
  });

  it("a search older than its 20-minute window claims nothing (audit P1-5)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch({
      created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
      deadline_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const [p] = await mkPharmacies(1);
    await mkQueued(searchId, p.ods_code);
    await expireForeign([searchId]);

    const res = await claim();
    expect(res.claimed).toBe(0);
  });

  it("mode.isolation — DEMO rows neither eat the cap nor get claimed (audit P1-1)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // a demo board with one dialing row and one juicy queued row
    const demoSearchId = await mkSearch({ dial_mode: "DEMO" });
    const [demoDialing] = await mkPharmacies(1);
    const [demoQueued] = await mkPharmacies(1);
    await mkQueued(demoSearchId, demoDialing.ods_code, 0.9, {
      status: "dialing",
      dial_mode: "DEV_TEST",
      claimed_at: new Date().toISOString(),
    });
    const demoQueuedId = await mkQueued(demoSearchId, demoQueued.ods_code, 0.99);

    // a real DEV_TEST search with one candidate
    const searchId = await mkSearch();
    const [p] = await mkPharmacies(1);
    const realCallId = await mkQueued(searchId, p.ods_code, 0.1);
    await expireForeign([demoSearchId, searchId]);

    // cap of ONE: if the demo dialing row counted, nothing could be claimed;
    // if demo queued rows were claimable, the 0.99-ranked demo row would win
    const res = await claim({ globalCap: 1 });
    expect(res.claimed).toBe(1);

    const { data: real } = await db.from("calls").select("status").eq("id", realCallId).single();
    expect(real?.status).toBe("dialing");
    const { data: demo } = await db.from("calls").select("status").eq("id", demoQueuedId).single();
    expect(demo?.status).toBe("queued");
  });

  it("a definite-rejection wave triggers exactly ONE bounded re-claim pass (audit P2-1)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const pharmacies = await mkPharmacies(2);
    for (const p of pharmacies) await mkQueued(searchId, p.ods_code);
    await expireForeign([searchId]);

    let callerInvocations = 0;
    const rejectAll: OutboundCaller = async () => {
      callerInvocations++;
      return { ok: false, definite: true, detail: "over capacity" };
    };
    const res = await dispatch({
      db,
      caller: rejectAll,
      dialMode: "DEV_TEST",
      devTestNumbers: TEAM,
      globalCap: 8,
    });

    // pass 1 claims both and frees both; pass 2 retries once; then STOP
    expect(res.posted).toBe(0);
    expect(res.freed).toBe(res.claimed);
    expect(res.claimed).toBe(4);
    expect(callerInvocations).toBe(4);

    const { data: rows } = await db
      .from("calls")
      .select("status")
      .eq("search_id", searchId);
    expect((rows ?? []).every((r) => r.status === "queued")).toBe(true);
  });
});
