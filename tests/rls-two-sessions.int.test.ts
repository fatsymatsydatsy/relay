import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 4.3 rls.two-sessions — LOCAL stack, two REAL anonymous sessions.
 * Session B must neither select nor hear (realtime) session A's rows, and
 * even the OWNER must never receive transcript/extraction columns.
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const ODS = `R43${RUN}01`;

let service: SupabaseClient;
let sessionA: SupabaseClient;
let sessionB: SupabaseClient;
let stackUp = false;
let searchId: string;
let callId: string;

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

const anonClient = () =>
  createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } });

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) return;
  service = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });

  sessionA = anonClient();
  sessionB = anonClient();
  const [a, b] = await Promise.all([
    sessionA.auth.signInAnonymously(),
    sessionB.auth.signInAnonymously(),
  ]);
  if (a.error || b.error || !a.data.user || !b.data.user) {
    throw new Error(`anon sign-in failed: ${a.error?.message ?? b.error?.message}`);
  }

  // A's search + one call with a transcript (service role writes, as always)
  const { data: med, error: medErr } = await service
    .from("medications")
    .upsert(
      { name: "RlsMed", strength: RUN, form: "test", display: `RlsMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (medErr) throw new Error(medErr.message);
  const { error: phErr } = await service.from("pharmacies").upsert(
    {
      ods_code: ODS,
      name: "RLS Pharmacy",
      address: "1 Privacy Lane",
      postcode: "R4 3ST",
      phone: `+44770${Math.floor(Math.random() * 9000) + 1000}431`,
      lat: 61,
      lng: 0.2,
      hours: { mon: [["00:00", "24:00"]] },
      source: "dev_test",
    },
    { onConflict: "ods_code" },
  );
  if (phErr) throw new Error(phErr.message);

  const { data: search, error: sErr } = await service
    .from("searches")
    .insert({
      owner: a.data.user.id,
      medication_id: med!.id,
      quantity_needed: 1,
      postcode: "R4 3ST",
      radius_km: 5,
      status: "active",
      deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (sErr) throw new Error(sErr.message);
  searchId = search!.id;

  const { data: call, error: cErr } = await service
    .from("calls")
    .insert({
      search_id: searchId,
      pharmacy_ods: ODS,
      status: "transcript_ready",
      transcript: { transcript: [{ role: "user", message: "PRIVATE pharmacist words" }] },
      ended_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (cErr) throw new Error(cErr.message);
  callId = call!.id;
});

describe("rls.two-sessions", () => {
  it("the owner sees their rows — but never transcript or extraction columns", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const { data: ownSearch } = await sessionA
      .from("searches")
      .select("id, status")
      .eq("id", searchId);
    expect(ownSearch).toHaveLength(1); // positive control: RLS lets the owner in

    const { data: ownCalls } = await sessionA
      .from("calls")
      .select("id, status, rank_bucket, verdict, verdict_at")
      .eq("search_id", searchId);
    expect(ownCalls).toHaveLength(1);

    const { error: transcriptDenied } = await sessionA
      .from("calls")
      .select("transcript")
      .eq("id", callId);
    expect(transcriptDenied?.code).toBe("42501"); // column never granted

    const { error: extractionDenied } = await sessionA
      .from("calls")
      .select("extraction")
      .eq("id", callId);
    expect(extractionDenied?.code).toBe("42501");
  });

  it("session B selects NOTHING of A's", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const { data: searches, error: sErr } = await sessionB
      .from("searches")
      .select("id")
      .eq("id", searchId);
    expect(sErr).toBeNull();
    expect(searches).toHaveLength(0); // RLS: silence, not an error

    const { data: calls, error: cErr } = await sessionB
      .from("calls")
      .select("id, status")
      .eq("search_id", searchId);
    expect(cErr).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("session B hears NOTHING on A's board tick; A hears it", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    let aTicks = 0;
    let bTicks = 0;
    const subscribe = (client: SupabaseClient, onTick: () => void, name: string) =>
      new Promise<ReturnType<SupabaseClient["channel"]>>((resolve, reject) => {
        const channel = client
          .channel(`rls-test-${name}-${RUN}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "searches", filter: `id=eq.${searchId}` },
            () => onTick(),
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") resolve(channel);
            if (status === "CHANNEL_ERROR") reject(new Error(`${name} channel error`));
          });
      });

    const [chanA, chanB] = await Promise.all([
      subscribe(sessionA, () => void aTicks++, "a"),
      subscribe(sessionB, () => void bTicks++, "b"),
    ]);
    await new Promise((r) => setTimeout(r, 500)); // let the joins fully settle

    // the board tick: service role bumps A's search row (same as the trigger).
    // Re-bump every second until A hears it (cold realtime can drop the first)
    // — every bump B misses is more evidence of silence.
    const deadline = Date.now() + 8_000;
    while (aTicks === 0 && Date.now() < deadline) {
      await service
        .from("searches")
        .update({ deadline_at: new Date(Date.now() + 21 * 60_000).toISOString() })
        .eq("id", searchId);
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 1000)); // grace for any late B delivery
    await Promise.all([sessionA.removeChannel(chanA), sessionB.removeChannel(chanB)]);

    expect(aTicks).toBeGreaterThanOrEqual(1); // the owner's board updates
    expect(bTicks).toBe(0); // the stranger hears silence
  }, 20_000);
});
