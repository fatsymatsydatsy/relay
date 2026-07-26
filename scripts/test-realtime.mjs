#!/usr/bin/env node
/**
 * 1.5 realtime proof (🤖 gate) — runs against the Supabase project in
 * .env.local (the cloud project; rows are namespaced fixtures + cleaned up).
 *
 * Board-tick design (see the board_tick migration): clients cannot subscribe
 * to `calls` (realtime needs table-level SELECT; calls has only column grants
 * to keep transcript/dial numbers private). A trigger bumps the parent
 * `searches` row on every calls change; the client subscribes to its OWN
 * searches row and refetches the column-granted calls per tick.
 *
 * Asserts, in order:
 *   1. anonymous sign-in works (two independent sessions);
 *   2. after a service-role UPDATE on a call, the owner's searches
 *      subscription ticks in < 2s (trigger + realtime);
 *   3. the refetched calls row shows the new status and does NOT contain a
 *      `transcript` field (column grants — raw transcripts never reach the
 *      client);
 *   4. a DIFFERENT anonymous session subscribed to the same search receives
 *      nothing (RLS isolation preview of rls.two-sessions).
 *
 * Usage: node scripts/test-realtime.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  } catch {}
  throw new Error(`missing env ${name}`);
}

const URL = env("NEXT_PUBLIC_SUPABASE_URL");
const ANON = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
const anonB = createClient(URL, ANON, { auth: { persistSession: false } });

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const MED_ID = "b0000000-0000-4000-8000-0000000000ff";
let searchId = null;

async function cleanup() {
  if (searchId) {
    await service.from("calls").delete().eq("search_id", searchId);
    await service.from("searches").delete().eq("id", searchId);
  }
}

try {
  // 1. two anonymous sessions
  const [a, b] = await Promise.all([
    anonA.auth.signInAnonymously(),
    anonB.auth.signInAnonymously(),
  ]);
  if (a.error || !a.data.session) fail(`anon sign-in A: ${a.error?.message}`);
  if (b.error || !b.data.session) fail(`anon sign-in B: ${b.error?.message}`);
  const uidA = a.data.user.id;
  console.log("PASS: two anonymous sessions established");

  // fixtures: med + pharmacy + a search owned by A with one queued call
  await service.from("medications").upsert(
    { id: MED_ID, name: "TEST", strength: "1", form: "test", display: "TEST-realtime-proof med" },
    { onConflict: "id" },
  );
  const { error: pharmErr } = await service.from("pharmacies").upsert(
    {
      ods_code: "FAKE01",
      name: "Wellfield Pharmacy",
      address: "42 High Street",
      postcode: "B5 4BU",
      phone: "+447700900001",
      lat: 52.4751,
      lng: -1.894,
      hours: { mon: [["00:00", "24:00"]] },
      source: "dev_test",
    },
    { onConflict: "ods_code" },
  );
  if (pharmErr) fail(`pharmacy upsert: ${pharmErr.message}`);

  const { data: search, error: searchErr } = await service
    .from("searches")
    .insert({
      owner: uidA,
      medication_id: MED_ID,
      quantity_needed: 1,
      postcode: "B5 4BU",
      radius_km: 5,
      deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (searchErr) fail(`search insert: ${searchErr.message}`);
  searchId = search.id;

  const { data: call, error: callErr } = await service
    .from("calls")
    .insert({ search_id: searchId, pharmacy_ods: "FAKE01", status: "queued" })
    .select("id")
    .single();
  if (callErr) fail(`call insert: ${callErr.message}`);

  // 2. subscriptions (A = owner, B = stranger)
  let resolveA;
  const gotA = new Promise((r) => (resolveA = r));
  let eventsB = 0;

  const chanA = anonA
    .channel("proof-a")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "searches", filter: `id=eq.${searchId}` },
      (payload) => resolveA(payload),
    );
  const chanB = anonB
    .channel("proof-b")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "searches", filter: `id=eq.${searchId}` },
      () => eventsB++,
    );

  await new Promise((resolve, reject) => {
    let ready = 0;
    const onStatus = (status) => {
      if (status === "SUBSCRIBED" && ++ready === 2) resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        reject(new Error(`subscribe: ${status}`));
    };
    chanA.subscribe(onStatus);
    chanB.subscribe(onStatus);
  });
  console.log("PASS: both subscriptions established");

  // 3. the update + latency
  const t0 = Date.now();
  const { error: updErr } = await service
    .from("calls")
    .update({ status: "dialing", dial_mode: "DEV_TEST", claimed_at: new Date().toISOString() })
    .eq("id", call.id);
  if (updErr) fail(`update: ${updErr.message}`);

  await Promise.race([
    gotA,
    new Promise((_, rej) => setTimeout(() => rej(new Error("no tick in 5s")), 5000)),
  ]);
  const latency = Date.now() - t0;
  if (latency >= 2000) fail(`tick took ${latency}ms (>= 2000ms)`);
  console.log(`PASS: owner's searches row ticked in ${latency}ms (< 2s)`);

  // per-tick refetch with the engine's exact column list
  const { data: rows, error: refetchErr } = await anonA
    .from("calls")
    .select("id, pharmacy_ods, status, rank_bucket, verdict, verdict_at")
    .eq("search_id", searchId);
  if (refetchErr || !rows?.length) fail(`calls refetch: ${refetchErr?.message ?? "no rows"}`);
  if (rows[0].status !== "dialing") fail(`refetched status ${rows[0].status}, expected dialing`);
  console.log("PASS: refetch shows the new status through granted columns");

  // and the transcript column is POSITIVELY denied to clients
  const { error: transcriptErr } = await anonA
    .from("calls")
    .select("transcript")
    .eq("search_id", searchId);
  if (!transcriptErr) fail("selecting calls.transcript as anon SUCCEEDED — grant leak");
  console.log("PASS: selecting transcript as the client is denied:", transcriptErr.message);

  // 4. stranger isolation (grace period for any stray delivery)
  await new Promise((r) => setTimeout(r, 1500));
  if (eventsB !== 0) fail(`stranger session received ${eventsB} event(s) — RLS leak`);
  console.log("PASS: second anonymous session received nothing (RLS isolation)");

  await anonA.removeChannel(chanA);
  await anonB.removeChannel(chanB);
  await cleanup();
  console.log("ALL REALTIME CHECKS PASSED");
  process.exit(0);
} catch (err) {
  await cleanup();
  fail(err.message ?? String(err));
}
