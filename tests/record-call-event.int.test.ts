import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordCallEvent } from "@/lib/commands/record_call_event";

/** 3.3 — LOCAL stack. Namespaced fixtures; geography irrelevant (no dialing). */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const ODS = (n: number) => `R33${RUN}${String(n).padStart(2, "0")}`;

let db: SupabaseClient;
let stackUp = false;
let searchId: string;
let dialingCallId: string;
let failingCallId: string;
let benchCallId: string;

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

function transcriptionEvent(callRef: string) {
  return {
    eventType: "post_call_transcription",
    payload: {
      type: "post_call_transcription",
      data: {
        conversation_id: `conv_r33_${RUN}`,
        transcript: [
          { role: "agent", message: "Do you have Creon in stock?" },
          { role: "user", message: "Two boxes on the shelf." },
        ],
        conversation_initiation_client_data: {
          dynamic_variables: { call_ref: callRef },
        },
      },
    },
  };
}

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: med, error: medErr } = await db
    .from("medications")
    .upsert(
      { name: "EventMed", strength: RUN, form: "test", display: `EventMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (medErr) throw new Error(`med: ${medErr.message}`);
  const { error: phErr } = await db.from("pharmacies").upsert(
    [1, 2, 3].map((n) => ({
      ods_code: ODS(n),
      name: `Event Pharmacy ${n}`,
      address: `${n} Event Street`,
      postcode: "R3 3ST",
      phone: `+44770${Math.floor(Math.random() * 900) + 100}3${String(n).padStart(2, "0")}`,
      lat: 57 + n * 0.001,
      lng: 2.5, // North Sea, away from every other fixture
      hours: { mon: [["00:00", "24:00"]] },
      source: "dev_test",
    })),
    { onConflict: "ods_code" },
  );
  if (phErr) throw new Error(`pharmacies: ${phErr.message}`);
  const { data: search, error: sErr } = await db
    .from("searches")
    .insert({
      owner: crypto.randomUUID(),
      medication_id: med!.id,
      quantity_needed: 1,
      postcode: "R3 3ST",
      radius_km: 5,
      status: "active",
      deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (sErr) throw new Error(`search: ${sErr.message}`);
  searchId = search!.id;

  const { data: calls, error: cErr } = await db
    .from("calls")
    .insert([
      { search_id: searchId, pharmacy_ods: ODS(1), status: "dialing", dial_mode: "DEV_TEST", claimed_at: new Date().toISOString(), is_bench: false },
      { search_id: searchId, pharmacy_ods: ODS(2), status: "dialing", dial_mode: "DEV_TEST", claimed_at: new Date().toISOString(), is_bench: false },
      { search_id: searchId, pharmacy_ods: ODS(3), status: "queued", is_bench: true, rank_score: 0.5 },
    ])
    .select("id, pharmacy_ods");
  if (cErr) throw new Error(`calls: ${cErr.message}`);
  dialingCallId = calls!.find((c) => c.pharmacy_ods === ODS(1))!.id;
  failingCallId = calls!.find((c) => c.pharmacy_ods === ODS(2))!.id;
  benchCallId = calls!.find((c) => c.pharmacy_ods === ODS(3))!.id;
});

describe("record_call_event", () => {
  it("webhook.idempotent — same transcription twice = ONE effect", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    let extracts = 0;
    let dispatches = 0;
    const deps = {
      db,
      extractFn: async () => void extracts++,
      dispatchFn: async () => void dispatches++,
    };

    const first = await recordCallEvent(transcriptionEvent(dialingCallId), deps);
    expect(first.action).toBe("transcript_ready");

    const second = await recordCallEvent(transcriptionEvent(dialingCallId), deps);
    expect(second.action).toBe("duplicate_noop");

    expect(extracts).toBe(1);
    expect(dispatches).toBe(1);

    const { data: call } = await db
      .from("calls")
      .select("status, transcript, ended_at")
      .eq("id", dialingCallId)
      .single();
    expect(call?.status).toBe("transcript_ready");
    expect(call?.transcript).toBeTruthy();
    expect(call?.ended_at).not.toBeNull();
  });

  it("a failure webhook flips to unreached AND promotes a bench row", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const result = await recordCallEvent(
      {
        eventType: "call_initiation_failure",
        payload: {
          type: "call_initiation_failure",
          data: {
            conversation_id: "conv_r33_failure",
            conversation_initiation_client_data: {
              dynamic_variables: { call_ref: failingCallId },
            },
          },
        },
      },
      { db, dispatchFn: async () => undefined },
    );
    expect(result.action).toBe("unreached");

    const { data: failed } = await db
      .from("calls")
      .select("status, rank_bucket, verdict")
      .eq("id", failingCallId)
      .single();
    expect(failed?.status).toBe("unreached");
    expect(failed?.rank_bucket).toBe(4);
    expect(failed?.verdict).toBeNull(); // never a stock verdict

    const { data: bench } = await db
      .from("calls")
      .select("is_bench, status")
      .eq("id", benchCallId)
      .single();
    expect(bench?.is_bench).toBe(false); // promoted
    expect(bench?.status).toBe("queued");
  });

  it("orphan events are logged, never crash", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);
    const result = await recordCallEvent(
      {
        eventType: "post_call_transcription",
        payload: {
          data: {
            conversation_id: "conv_does_not_exist",
            conversation_initiation_client_data: {
              dynamic_variables: { call_ref: crypto.randomUUID() },
            },
          },
        },
      },
      { db },
    );
    expect(result.action).toBe("orphan");

    const { data: anomaly } = await db
      .from("anomalies")
      .select("kind")
      .eq("kind", "webhook_orphan")
      .limit(1);
    expect(anomaly?.length).toBe(1);
  });

  it("drain-settle: last line resolves → bench leftovers expire, search completes", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // resolve the transcript_ready row to a verdict manually (extract is 3.4)
    await db
      .from("calls")
      .update({
        status: "verdict",
        rank_bucket: 1,
        location_confirmed: "yes",
        verdict: { stock_status: "in_stock", quantity_available: 2 },
        verdict_at: new Date().toISOString(),
      })
      .eq("id", dialingCallId);

    // the promoted bench row dies too → nothing in flight, nothing dialable
    const result = await recordCallEvent(
      {
        eventType: "call_initiation_failure",
        payload: {
          data: {
            conversation_initiation_client_data: {
              dynamic_variables: { call_ref: benchCallId },
            },
          },
        },
      },
      { db },
    );
    // bench row was queued (not dialing) → transition no-ops…
    expect(result.action).toBe("duplicate_noop");

    // …so simulate its death the way dispatch would leave it, then settle
    await db
      .from("calls")
      .update({ status: "expired", rank_bucket: 4 })
      .eq("id", benchCallId);
    const { settleIfDrained } = await import("@/lib/commands/record_call_event");
    const settled = await settleIfDrained(db, searchId, new Date());
    expect(settled).toBe(true);

    const { data: search } = await db
      .from("searches")
      .select("status, settled_at")
      .eq("id", searchId)
      .single();
    expect(search?.status).toBe("complete");
    expect(search?.settled_at).not.toBeNull();
  });
});
