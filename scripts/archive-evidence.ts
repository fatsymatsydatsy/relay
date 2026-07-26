/**
 * 5.2.1 — archive one search's logs to /evidence (public-repo safe).
 *
 *   npx tsx scripts/archive-evidence.ts [searchId] [--local] [--label 5.2] [--dry]
 *
 * Default target: the latest REAL search. Pulls the four log layers
 * (searches, calls, dial_log, call_events), builds the markdown report via
 * the unit-tested `buildEvidenceReport`, and writes
 * `evidence/<date>-<mode>-<label>.md` + a raw JSON sidecar.
 *
 * Safety: transcript bodies are never SELECTed (column list is explicit), so
 * they cannot reach the repo; DEV_TEST team numbers are masked in both the
 * report (domain rule) and the JSON sidecar (here). `--dry` prints without
 * writing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./env-local";
import {
  buildEvidenceReport,
  maskPhoneLast6,
  type EvidenceCall,
  type EvidenceDial,
  type EvidenceInput,
} from "../lib/domain/evidence";

const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const env = loadEnvLocal();
  const local = has("local");
  const db = local
    ? createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } })
    : createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });

  const explicitId = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
  const searchCols =
    "id, dial_mode, quantity_needed, postcode, status, created_at, deadline_at, settled_at, medications(display)";
  const { data: search, error: sErr } = explicitId
    ? await db.from("searches").select(searchCols).eq("id", explicitId).single()
    : await db
        .from("searches")
        .select(searchCols)
        .eq("dial_mode", "REAL")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
  if (sErr || !search) {
    throw new Error(
      `no search found (${sErr?.message ?? "empty"}) — pass an id, or run the REAL search first`,
    );
  }

  // Explicit column list — transcript is deliberately absent and stays in the DB.
  const { data: callRows, error: cErr } = await db
    .from("calls")
    .select(
      "id, pharmacy_ods, status, is_bench, dial_mode, resolved_number, claimed_at, ended_at, verdict_at, rank_bucket, location_confirmed, verdict, conversation_id, pharmacies(name)",
    )
    .eq("search_id", search.id)
    .order("claimed_at", { ascending: true, nullsFirst: false });
  if (cErr) throw new Error(cErr.message);
  const callIds = (callRows ?? []).map((c) => c.id);
  // call_events rows are written raw BEFORE correlation, so they carry
  // conversation_id and never call_id — join on conv id, as the system does.
  const convIds = (callRows ?? []).map((c) => c.conversation_id).filter(Boolean) as string[];

  const { data: dials, error: dErr } = callIds.length
    ? await db
        .from("dial_log")
        .select("phone, outcome, dialed_at, call_id")
        .in("call_id", callIds)
        .order("dialed_at")
    : { data: [], error: null };
  if (dErr) throw new Error(dErr.message);

  const { data: events, error: eErr } = convIds.length
    ? await db.from("call_events").select("event_type").in("conversation_id", convIds)
    : { data: [], error: null };
  if (eErr) throw new Error(eErr.message);
  const eventCounts: Record<string, number> = {};
  for (const e of events ?? []) eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1;

  const devTest = search.dial_mode === "DEV_TEST";
  const meds = search.medications as { display: string } | { display: string }[] | null;
  const calls: EvidenceCall[] = (callRows ?? []).map((c) => {
    const ph = c.pharmacies as { name?: string } | { name?: string }[] | null;
    return {
      pharmacy_name: (Array.isArray(ph) ? ph[0]?.name : ph?.name) ?? c.pharmacy_ods,
      pharmacy_ods: c.pharmacy_ods,
      status: c.status,
      is_bench: c.is_bench,
      dial_mode: c.dial_mode,
      resolved_number: c.resolved_number,
      claimed_at: c.claimed_at,
      ended_at: c.ended_at,
      verdict_at: c.verdict_at,
      rank_bucket: c.rank_bucket,
      location_confirmed: c.location_confirmed,
      verdict: c.verdict,
    };
  });
  // The builder needs REAL numbers for the distinctness proof (two team
  // phones sharing a last-6 must not read as a duplicate); it never renders
  // dial_log phones. Masking happens once, on the sidecar below.
  const dialLog: EvidenceDial[] = (dials ?? []).map((d) => ({
    phone: d.phone,
    outcome: d.outcome,
    dialed_at: d.dialed_at,
  }));

  const input: EvidenceInput = {
    search: {
      id: search.id,
      dial_mode: search.dial_mode,
      medication_name: (Array.isArray(meds) ? meds[0]?.display : meds?.display) ?? "unknown",
      quantity_needed: search.quantity_needed,
      postcode: search.postcode,
      status: search.status,
      created_at: search.created_at,
      deadline_at: search.deadline_at,
      settled_at: search.settled_at,
    },
    calls,
    dialLog,
    eventCounts,
    generatedAt: new Date().toISOString(),
  };
  const report = buildEvidenceReport(input);
  console.log(report);

  if (has("dry")) {
    console.log("--dry: nothing written.");
    return;
  }
  const label = arg("label") ?? "5.2";
  const date = input.generatedAt.slice(0, 10);
  const base = `${date}-${search.dial_mode.toLowerCase()}-${label}`;
  mkdirSync(join(process.cwd(), "evidence"), { recursive: true });
  const mdPath = join("evidence", `${base}.md`);
  const jsonPath = join("evidence", `${base}.json`);
  writeFileSync(mdPath, report);
  // Sidecar: same transcript-free data, with DEV_TEST numbers masked before
  // anything touches the repo (search-level for dial_log — a DEV_TEST
  // search's dial_log is team phones by construction; per-call for calls).
  const sidecar = {
    ...input,
    dialLog: input.dialLog.map((d) => ({
      ...d,
      phone: devTest ? maskPhoneLast6(d.phone) : d.phone,
    })),
    calls: input.calls.map((c) => ({
      ...c,
      resolved_number:
        c.resolved_number && c.dial_mode === "DEV_TEST"
          ? maskPhoneLast6(c.resolved_number)
          : c.resolved_number,
    })),
  };
  writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2) + "\n");
  console.log(`written: ${mdPath} + ${jsonPath} (${local ? "LOCAL" : "CLOUD"} data)`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
