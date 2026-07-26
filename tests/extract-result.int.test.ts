import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractResult } from "@/lib/commands/extract_result";
import type { ChatJsonFn } from "@/lib/integrations/openai";

/** 3.4 — LOCAL stack; scripted LLM replays 5 transcript shapes end-to-end. */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const ODS = (n: number) => `X34${RUN}${String(n).padStart(2, "0")}`;

let db: SupabaseClient;
let stackUp = false;
let searchId: string;
let otherSearchId: string;
let callIds: Record<string, string> = {};
let fanoutQueuedId: string;

const base = {
  quantity_available_verbatim: null as string | null,
  quantity_meets_need: "unknown" as const,
  orderable: "unknown" as const,
  eta_verbatim: null as string | null,
  shortage_mentioned: false,
  notable_quotes: [] as string[],
};

/** the five replayed outcomes, §5-shaped, keyed by scenario */
const SCRIPTS: Record<string, (ref: string) => object> = {
  partial: (ref) => ({
    ...base,
    call_ref: ref,
    outcome: "completed",
    location_confirmed: "yes",
    stock_status: "in_stock",
    quantity_available_verbatim: "one box",
    quantity_meets_need: "no",
    notable_quotes: ["only one box left I'm afraid"],
  }),
  orderable: (ref) => ({
    ...base,
    call_ref: ref,
    outcome: "completed",
    location_confirmed: "yes",
    stock_status: "out_of_stock",
    orderable: "yes",
    eta_verbatim: "Thursday at the earliest",
  }),
  plainNo: (ref) => ({
    ...base,
    call_ref: ref,
    outcome: "completed",
    location_confirmed: "yes",
    stock_status: "out_of_stock",
    orderable: "no",
    shortage_mentioned: true,
  }),
  wrongBranch: (ref) => ({
    ...base,
    call_ref: ref,
    outcome: "wrong_location",
    location_confirmed: "no",
    stock_status: "not_asked",
  }),
  voicemail: (ref) => ({
    ...base,
    call_ref: ref,
    outcome: "voicemail",
    location_confirmed: "unclear",
    stock_status: "not_asked",
  }),
};

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
      { name: "ExtractMed", strength: RUN, form: "test", display: `ExtractMed-${RUN}` },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (medErr) throw new Error(medErr.message);

  const scenarios = Object.keys(SCRIPTS); // 5
  const { error: phErr } = await db.from("pharmacies").upsert(
    scenarios.map((s, i) => ({
      ods_code: ODS(i + 1),
      name: `Extract Pharmacy ${s}`,
      address: `${i + 1} Extract Row`,
      postcode: "X3 4ST",
      phone: `+44770${Math.floor(Math.random() * 900) + 100}4${String(i + 1).padStart(2, "0")}`,
      lat: 58 + i * 0.001,
      lng: 3.5,
      hours: { mon: [["00:00", "24:00"]] },
      source: "dev_test",
    })),
    { onConflict: "ods_code" },
  );
  if (phErr) throw new Error(phErr.message);

  const mkSearch = async () => {
    const { data, error } = await db
      .from("searches")
      .insert({
        owner: crypto.randomUUID(),
        medication_id: med!.id,
        quantity_needed: 2,
        postcode: "X3 4ST",
        radius_km: 5,
        status: "active",
        deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id as string;
  };
  searchId = await mkSearch();
  otherSearchId = await mkSearch();

  for (const [i, scenario] of scenarios.entries()) {
    const { data, error } = await db
      .from("calls")
      .insert({
        search_id: searchId,
        pharmacy_ods: ODS(i + 1),
        status: "transcript_ready",
        is_bench: false,
        transcript: { transcript: [{ role: "user", message: `scenario ${scenario}` }] },
        ended_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    callIds[scenario] = data!.id;
  }

  // the fan-out receiver: other search queues the SAME pharmacy as `partial`
  const { data: fq, error: fqErr } = await db
    .from("calls")
    .insert({
      search_id: otherSearchId,
      pharmacy_ods: ODS(1),
      status: "queued",
      is_bench: false,
      rank_score: 0.9,
    })
    .select("id")
    .single();
  if (fqErr) throw new Error(fqErr.message);
  fanoutQueuedId = fq!.id;
});

describe("extract_result", () => {
  it("replays 5 stored transcripts into the right statuses and buckets", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const llm: ChatJsonFn = async ({ user }) => {
      const scenario = Object.keys(SCRIPTS).find((s) =>
        user.includes(`scenario ${s}`),
      )!;
      return JSON.stringify(SCRIPTS[scenario](callIds[scenario]));
    };

    for (const scenario of Object.keys(SCRIPTS)) {
      await extractResult(callIds[scenario], { db, llm });
    }

    const { data: rows } = await db
      .from("calls")
      .select("id, status, rank_bucket, verdict, verdict_at, location_confirmed")
      .in("id", Object.values(callIds));
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));

    const partial = byId.get(callIds.partial)!;
    expect(partial.status).toBe("verdict");
    expect(partial.rank_bucket).toBe(1);
    expect(partial.verdict?.stock_status).toBe("in_stock");
    expect(partial.verdict?.quantity_available).toBe(1);
    expect(partial.verdict_at).not.toBeNull();

    const orderable = byId.get(callIds.orderable)!;
    expect(orderable.rank_bucket).toBe(2);
    expect(orderable.verdict?.stock_status).toBe("orderable");
    expect(orderable.verdict?.eta).toBe("Thursday at the earliest");

    const plainNo = byId.get(callIds.plainNo)!;
    expect(plainNo.rank_bucket).toBe(3);
    expect(plainNo.verdict?.shortage_mentioned).toBe(true);

    const wrongBranch = byId.get(callIds.wrongBranch)!;
    expect(wrongBranch.status).toBe("wrong_location");
    expect(wrongBranch.rank_bucket).toBe(4);
    expect(wrongBranch.verdict).toBeNull();

    const voicemail = byId.get(callIds.voicemail)!;
    expect(voicemail.status).toBe("unreached");
    expect(voicemail.rank_bucket).toBe(4);
    expect(voicemail.verdict).toBeNull();
  });

  it("fans a fresh verdict out to same-pharmacy+med queued calls", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const { data: fanned } = await db
      .from("calls")
      .select("status, rank_bucket, verdict, copied_from_call_id")
      .eq("id", fanoutQueuedId)
      .single();
    expect(fanned?.status).toBe("verdict");
    expect(fanned?.rank_bucket).toBe(1);
    expect(fanned?.copied_from_call_id).toBe(callIds.partial);
  });

  it("re-running after success is a no-op (extraction is re-runnable)", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);
    const again = await extractResult(callIds.partial, {
      db,
      llm: async () => {
        throw new Error("must not be called");
      },
    });
    expect(again.action).toBe("noop");
  });

  it("two schema failures escalate to gpt-5.6-sol; total failure is honest bucket 4", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // a fresh transcript_ready row for the failure path
    const { data: extra, error } = await db
      .from("calls")
      .insert({
        search_id: otherSearchId,
        pharmacy_ods: ODS(2),
        status: "transcript_ready",
        is_bench: false,
        transcript: { transcript: [{ role: "user", message: "garbled" }] },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const modelsSeen: string[] = [];
    const failing: ChatJsonFn = async ({ model }) => {
      modelsSeen.push(model);
      return "not json at all";
    };
    const outcome = await extractResult(extra!.id, { db, llm: failing });

    expect(outcome.action).toBe("extraction_failed");
    expect(modelsSeen).toEqual(["gpt-5.4-mini", "gpt-5.4-mini", "gpt-5.6-sol"]);

    const { data: failed } = await db
      .from("calls")
      .select("status, rank_bucket, extraction_attempts, verdict")
      .eq("id", extra!.id)
      .single();
    expect(failed?.status).toBe("extraction_failed");
    expect(failed?.rank_bucket).toBe(4);
    expect(failed?.extraction_attempts).toBe(3);
    expect(failed?.verdict).toBeNull();

    const { data: anomaly } = await db
      .from("anomalies")
      .select("kind")
      .eq("kind", "extraction_failed");
    expect((anomaly ?? []).length).toBeGreaterThan(0);
  });
});
