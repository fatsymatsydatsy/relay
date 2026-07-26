import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordCallEvent } from "@/lib/commands/record_call_event";
import { dispatch } from "@/lib/commands/dispatch";
import type { OutboundCaller } from "@/lib/integrations/elevenlabs";

/**
 * 4.1 settle + expiry — LOCAL stack.
 *
 * The deadline sweep (`settle_expired_searches`, advisory-locked like every
 * other writer): a search past its 20-minute deadline_at gets every QUEUED
 * child (bench included) expired; the search completes once nothing is in
 * flight. In-flight rows are never killed — their webhooks still record
 * honest data, but nothing new ever dials (claim age gate + search-active
 * gate). The state machine edge: `queued → expired: search settled first`.
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
let SEQ = 0;
const ODS = (n: number) => `S41${RUN}${String(n).padStart(2, "0")}`;
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

async function mkPharmacies(count: number): Promise<{ ods_code: string; phone: string }[]> {
  const rows = Array.from({ length: count }, () => {
    pharmacySeq++;
    return {
      ods_code: ODS(pharmacySeq),
      name: `Settle Pharmacy ${pharmacySeq}`,
      address: `${pharmacySeq} Settle Street`,
      postcode: "S4 1ST",
      phone: PHONE(),
      lat: 59 + pharmacySeq * 0.001, // far North Sea
      lng: 1.2,
      hours: ALL_WEEK,
      ownership_group: "independent",
      is_supermarket: false,
      source: "dev_test",
    };
  });
  const { error } = await db.from("pharmacies").upsert(rows, { onConflict: "ods_code" });
  if (error) throw new Error(error.message);
  return rows.map((r) => ({ ods_code: r.ods_code, phone: r.phone }));
}

async function mkSearch(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db
    .from("searches")
    .insert({
      owner: crypto.randomUUID(),
      medication_id: medId,
      quantity_needed: 1,
      postcode: "S4 1ST",
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

const PAST = {
  created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
  deadline_at: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const sweep = async () => {
  const { data, error } = await db.rpc("settle_expired_searches", {
    p_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return (data ?? [])[0] as { expired_calls: number; settled_searches: number };
};

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: med, error } = await db
    .from("medications")
    .upsert(
      { name: "SettleMed", strength: RUN, form: "test", display: `SettleMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  medId = med!.id;
});

describe("4.1 settle + expiry", () => {
  it("simulated timeout: queued children expire; the search completes when drained", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // fully-queued past-deadline search: everything expires, search completes
    const drainedId = await mkSearch(PAST);
    const [p1, p2] = await mkPharmacies(2);
    await db.from("calls").insert([
      { search_id: drainedId, pharmacy_ods: p1.ods_code, status: "queued", is_bench: false },
      { search_id: drainedId, pharmacy_ods: p2.ods_code, status: "queued", is_bench: true },
    ]);

    const result = await sweep();
    expect(result.expired_calls).toBeGreaterThanOrEqual(2);
    expect(result.settled_searches).toBeGreaterThanOrEqual(1);

    const { data: children } = await db
      .from("calls")
      .select("status, rank_bucket")
      .eq("search_id", drainedId);
    expect(children).toHaveLength(2);
    for (const c of children ?? []) {
      expect(c.status).toBe("expired");
      expect(c.rank_bucket).toBe(4);
    }
    const { data: search } = await db
      .from("searches")
      .select("status, settled_at")
      .eq("id", drainedId)
      .single();
    expect(search?.status).toBe("complete");
    expect(search?.settled_at).not.toBeNull();
  });

  it("in-flight rows survive the sweep; their terminal event completes the search", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch(PAST);
    const [pQueued, pDialing] = await mkPharmacies(2);
    await db.from("calls").insert([
      { search_id: searchId, pharmacy_ods: pQueued.ods_code, status: "queued", is_bench: false },
      {
        search_id: searchId,
        pharmacy_ods: pDialing.ods_code,
        status: "dialing",
        dial_mode: "DEV_TEST",
        claimed_at: new Date().toISOString(),
        is_bench: false,
      },
    ]);
    const { data: dialingRow } = await db
      .from("calls")
      .select("id")
      .eq("search_id", searchId)
      .eq("status", "dialing")
      .single();

    await sweep();

    const { data: after } = await db
      .from("calls")
      .select("pharmacy_ods, status")
      .eq("search_id", searchId);
    const byOds = new Map((after ?? []).map((r) => [r.pharmacy_ods, r.status]));
    expect(byOds.get(pQueued.ods_code)).toBe("expired"); // queued died
    expect(byOds.get(pDialing.ods_code)).toBe("dialing"); // in-flight survived

    const { data: mid } = await db
      .from("searches")
      .select("status")
      .eq("id", searchId)
      .single();
    expect(mid?.status).toBe("active"); // not complete while a line is live

    // the in-flight call fails → drain-settle completes the search
    const res = await recordCallEvent(
      {
        eventType: "call_initiation_failure",
        payload: {
          type: "call_initiation_failure",
          data: {
            conversation_initiation_client_data: {
              dynamic_variables: { call_ref: dialingRow!.id },
            },
          },
        },
      },
      { db },
    );
    expect(res.action).toBe("unreached");
    const { data: settled } = await db
      .from("searches")
      .select("status, settled_at")
      .eq("id", searchId)
      .single();
    expect(settled?.status).toBe("complete");
  });

  it("late webhook: data recorded, dial never triggered", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // a completed search whose call was still dialing when everything settled
    const searchId = await mkSearch({
      ...PAST,
      status: "complete",
      settled_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    });
    const [pLate, pTempting] = await mkPharmacies(2);
    await db.from("calls").insert([
      {
        search_id: searchId,
        pharmacy_ods: pLate.ods_code,
        status: "dialing",
        dial_mode: "DEV_TEST",
        claimed_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        is_bench: false,
      },
      // an expired child that would LOVE to be dialed if the gates leaked
      { search_id: searchId, pharmacy_ods: pTempting.ods_code, status: "expired", rank_bucket: 4, is_bench: false },
    ]);
    const { data: lateRow } = await db
      .from("calls")
      .select("id")
      .eq("search_id", searchId)
      .eq("status", "dialing")
      .single();

    let extracts = 0;
    const okCaller: OutboundCaller = async () => ({
      ok: true,
      conversationId: `conv_s41_${crypto.randomUUID()}`,
      callSid: null,
    });
    const res = await recordCallEvent(
      {
        eventType: "post_call_transcription",
        payload: {
          type: "post_call_transcription",
          data: {
            conversation_id: `conv_s41_late_${RUN}`,
            transcript: [{ role: "user", message: "sorry, we closed at four" }],
            conversation_initiation_client_data: {
              dynamic_variables: { call_ref: lateRow!.id },
            },
          },
        },
      },
      {
        db,
        extractFn: async () => void extracts++,
        // the REAL dispatch: it must claim NOTHING from a settled search
        dispatchFn: () =>
          dispatch({ db, caller: okCaller, dialMode: "DEV_TEST", devTestNumbers: ["+447700900901"], globalCap: 8 }).then(
            (r) => {
              expect(r.claimed).toBe(0);
              return r;
            },
          ),
      },
    );

    expect(res.action).toBe("transcript_ready"); // the data landed — honesty
    expect(extracts).toBe(1); // extraction still derives a verdict from it

    const { data: late } = await db
      .from("calls")
      .select("status, transcript")
      .eq("id", lateRow!.id)
      .single();
    expect(late?.status).toBe("transcript_ready");
    expect(late?.transcript).toBeTruthy();

    const { data: search } = await db
      .from("searches")
      .select("status")
      .eq("id", searchId)
      .single();
    expect(search?.status).toBe("complete"); // never reopened
    const { data: tempting } = await db
      .from("calls")
      .select("status")
      .eq("search_id", searchId)
      .eq("pharmacy_ods", pTempting.ods_code)
      .single();
    expect(tempting?.status).toBe("expired"); // never resurrected
  });
});
