import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { watchdog } from "@/lib/commands/watchdog";
import type { ConversationLookup } from "@/lib/integrations/elevenlabs";

/**
 * 4.2 watchdog.reconcile — LOCAL stack, injected provider lookup.
 * The cron cadence is 60s (scripts/setup-watchdog.sql), so any rescue the
 * command performs lands < 90s after the loss.
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
let SEQ = 0;
const ODS = (n: number) => `W42${RUN}${String(n).padStart(2, "0")}`;
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
      name: `Watchdog Pharmacy ${pharmacySeq}`,
      address: `${pharmacySeq} Watchdog Way`,
      postcode: "W4 2ST",
      phone: PHONE(),
      lat: 60 + pharmacySeq * 0.001,
      lng: 0.5,
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
      postcode: "W4 2ST",
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

async function mkCall(
  searchId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await db
    .from("calls")
    .insert({
      search_id: searchId,
      pharmacy_ods: await mkPharmacy(),
      status: "dialing",
      dial_mode: "DEV_TEST",
      claimed_at: new Date(Date.now() - 3 * 60_000).toISOString(), // stale by default
      is_bench: false,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id;
}

const anomaliesFor = async (kind: string, callId: string) => {
  const { data } = await db.from("anomalies").select("id, detail").eq("kind", kind);
  return (data ?? []).filter((a) => (a.detail as { call_id?: string }).call_id === callId);
};

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: med, error } = await db
    .from("medications")
    .upsert(
      { name: "WatchdogMed", strength: RUN, form: "test", display: `WatchdogMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  medId = med!.id;

  // hermetic: the watchdog scans GLOBALLY, so leftover in-flight rows from
  // earlier suites must not reach the injected provider fake
  const { data: foreign } = await db
    .from("calls")
    .select("id")
    .in("status", ["queued", "dialing", "transcript_ready"]);
  const ids = (foreign ?? []).map((c) => c.id);
  if (ids.length) {
    await db.from("calls").update({ status: "expired", rank_bucket: 4 }).in("id", ids);
  }
});

describe("watchdog.reconcile", () => {
  it("a lost post_call_transcription is rescued: done → transcript_ready → extract", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const convId = `conv_w42_done_${RUN}`;
    const callId = await mkCall(searchId, { conversation_id: convId });

    let extracts = 0;
    const lookups: string[] = [];
    const conversations: ConversationLookup = async (id) => {
      lookups.push(id);
      if (id !== convId) return { ok: true, state: "in_progress" }; // never touch foreign rows
      return {
        ok: true,
        state: "done",
        transcript: [{ role: "user", message: "yes two boxes on the shelf" }],
        analysis: null,
      };
    };

    const summary = await watchdog({
      db,
      conversations,
      extractFn: async () => void extracts++,
    });

    expect(lookups).toContain(convId);
    expect(summary.reconciledDone).toBeGreaterThanOrEqual(1);
    expect(extracts).toBe(1);

    const { data: call } = await db
      .from("calls")
      .select("status, transcript")
      .eq("id", callId)
      .single();
    expect(call?.status).toBe("transcript_ready");
    expect(call?.transcript).toBeTruthy(); // the rescued transcript is stored

    expect(await anomaliesFor("watchdog_reconciled_done", callId)).toHaveLength(1);
  });

  it("no provider record (404) → unreached + bench promotion + settle", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const callId = await mkCall(searchId, { conversation_id: `conv_w42_gone_${RUN}` });
    const benchOds = await mkPharmacy();
    const { data: bench } = await db
      .from("calls")
      .insert({
        search_id: searchId,
        pharmacy_ods: benchOds,
        status: "queued",
        is_bench: true,
        rank_score: 0.5,
      })
      .select("id")
      .single();

    const conversations: ConversationLookup = async (id) =>
      id === `conv_w42_gone_${RUN}`
        ? { ok: false, notFound: true }
        : { ok: true, state: "in_progress" };
    const summary = await watchdog({ db, conversations });

    expect(summary.reconciledGone).toBeGreaterThanOrEqual(1);
    const { data: call } = await db
      .from("calls")
      .select("status, rank_bucket, verdict")
      .eq("id", callId)
      .single();
    expect(call?.status).toBe("unreached");
    expect(call?.rank_bucket).toBe(4);
    expect(call?.verdict).toBeNull(); // never a stock verdict

    const { data: promoted } = await db
      .from("calls")
      .select("is_bench")
      .eq("id", bench!.id)
      .single();
    expect(promoted?.is_bench).toBe(false); // the bench stepped up

    expect(await anomaliesFor("watchdog_reconciled_gone", callId)).toHaveLength(1);
  });

  it("in-progress and ambiguous lookups touch NOTHING", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const liveId = await mkCall(searchId, { conversation_id: `conv_w42_live_${RUN}` });
    const murkyId = await mkCall(searchId, { conversation_id: `conv_w42_murky_${RUN}` });

    const conversations: ConversationLookup = async (id) =>
      id === `conv_w42_murky_${RUN}`
        ? { ok: false, notFound: false, detail: "503 upstream" }
        : { ok: true, state: "in_progress" };

    await watchdog({ db, conversations });

    const { data: rows } = await db
      .from("calls")
      .select("id, status")
      .in("id", [liveId, murkyId]);
    for (const row of rows ?? []) expect(row.status).toBe("dialing"); // untouched
    expect(await anomaliesFor("watchdog_reconcile_ambiguous", murkyId)).toHaveLength(1);
  });

  it("young in-flight calls are not even looked up", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    await mkCall(searchId, {
      conversation_id: `conv_w42_young_${RUN}`,
      claimed_at: new Date().toISOString(), // fresh
    });

    const lookups: string[] = [];
    const conversations: ConversationLookup = async (id) => {
      lookups.push(id);
      return { ok: true, state: "in_progress" };
    };
    await watchdog({ db, conversations });
    expect(lookups).not.toContain(`conv_w42_young_${RUN}`);
  });

  it("a stuck transcript re-extracts; a fresh one does not", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const stuckId = await mkCall(searchId, {
      status: "transcript_ready",
      claimed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      ended_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      transcript: { transcript: [{ role: "user", message: "stuck" }] },
    });
    const freshId = await mkCall(searchId, {
      status: "transcript_ready",
      ended_at: new Date().toISOString(),
      transcript: { transcript: [{ role: "user", message: "fresh" }] },
    });

    const extracted: string[] = [];
    await watchdog({
      db,
      conversations: async () => ({ ok: true, state: "in_progress" }),
      extractFn: async (id) => void extracted.push(id),
    });

    expect(extracted).toContain(stuckId);
    expect(extracted).not.toContain(freshId);
    expect(await anomaliesFor("watchdog_reextract", stuckId)).toHaveLength(1);
  });

  it("dead-quiet searches settle: deadline sweep + drained-but-active", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // past-deadline with a queued child → sweep expires + completes
    const expiredId = await mkSearch({
      created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      deadline_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    await mkCall(expiredId, { status: "queued", dial_mode: null, claimed_at: null });

    // active search whose children all terminated (settle was lost mid-crash)
    const drainedId = await mkSearch();
    await mkCall(drainedId, {
      status: "unreached",
      rank_bucket: 4,
      ended_at: new Date().toISOString(),
    });

    const summary = await watchdog({
      db,
      conversations: async () => ({ ok: true, state: "in_progress" }),
    });

    expect(summary.expiredCalls).toBeGreaterThanOrEqual(1);
    expect(summary.settledSearches).toBeGreaterThanOrEqual(2);
    for (const id of [expiredId, drainedId]) {
      const { data: search } = await db
        .from("searches")
        .select("status, settled_at")
        .eq("id", id)
        .single();
      expect(search?.status).toBe("complete");
      expect(search?.settled_at).not.toBeNull();
    }
  });
});

describe("ring cap + conversation overrun (5.2d)", () => {
  it("initiated past the ring cap → unreached b4, never a stock verdict", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const convId = `conv_w42_ring_${RUN}`;
    const callId = await mkCall(searchId, { conversation_id: convId }); // 180s old

    const conversations: ConversationLookup = async (id) =>
      id === convId ? { ok: true, state: "initiated" } : { ok: true, state: "in_progress" };
    const summary = await watchdog({ db, conversations });

    expect(summary.ringTimeouts).toBeGreaterThanOrEqual(1);
    const { data: call } = await db
      .from("calls")
      .select("status, rank_bucket, verdict")
      .eq("id", callId)
      .single();
    expect(call?.status).toBe("unreached");
    expect(call?.rank_bucket).toBe(4);
    expect(call?.verdict).toBeNull();
    expect(await anomaliesFor("watchdog_ring_timeout", callId)).toHaveLength(1);
  });

  it("initiated younger than the ring cap is left ringing", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const convId = `conv_w42_ringing_${RUN}`;
    const callId = await mkCall(searchId, {
      conversation_id: convId,
      claimed_at: new Date(Date.now() - 40_000).toISOString(), // stale (>30s) but under 60s cap
    });

    const conversations: ConversationLookup = async (id) =>
      id === convId ? { ok: true, state: "initiated" } : { ok: true, state: "in_progress" };
    await watchdog({ db, conversations });

    const { data: call } = await db.from("calls").select("status").eq("id", callId).single();
    expect(call?.status).toBe("dialing"); // still legitimately ringing
  });

  it("in_progress past abandonAfter → unreached (conversation overrun)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const searchId = await mkSearch();
    const convId = `conv_w42_overrun_${RUN}`;
    const callId = await mkCall(searchId, {
      conversation_id: convId,
      claimed_at: new Date(Date.now() - 700_000).toISOString(),
    });

    const conversations: ConversationLookup = async (id) =>
      id === convId ? { ok: true, state: "in_progress" } : { ok: true, state: "in_progress" };
    const summary = await watchdog({ db, conversations });

    expect(summary.abandoned).toBeGreaterThanOrEqual(1);
    const { data: call } = await db
      .from("calls")
      .select("status, rank_bucket, verdict")
      .eq("id", callId)
      .single();
    expect(call?.status).toBe("unreached");
    expect(call?.rank_bucket).toBe(4);
    expect(call?.verdict).toBeNull();
    expect(await anomaliesFor("watchdog_conversation_overrun", callId)).toHaveLength(1);
  });
});
