import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { watchdog } from "@/lib/commands/watchdog";
import type { ConversationLookup } from "@/lib/integrations/elevenlabs";

/**
 * watchdog.demo-inert (4.6.1, audit P1-1) — LOCAL stack, REAL demo fixtures.
 *
 * The audit found the watchdog treats DEMO boards as production work: the
 * fixture `transcript_ready` row (no transcript!) crosses the re-extract
 * threshold ~72s after creation, the fake `dialing` row abandons at 600s,
 * and the deadline sweep completes the board at 14 minutes — i.e. the video
 * fallback decays while you film it. This test creates a REAL demo board via
 * the command and ticks the watchdog well past every threshold; every row
 * and the search itself must be byte-identical afterwards, with no provider
 * lookup and no extraction invoked.
 *
 * Deliberately NOT hermetic in the usual way: no foreign-row cleanup, because
 * the whole point is that the watchdog runs globally and must still skip DEMO.
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let db: SupabaseClient;
let stackUp = false;

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
});

describe("watchdog.demo-inert", () => {
  it("a real demo board survives repeated ticks unchanged, and is never looked up", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    // the command itself writes the board (fixtures, statuses, timings)
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_KEY;
    const { createDemoSearch } = await import("@/lib/commands/demo_search");
    const { searchId } = await createDemoSearch({
      owner: crypto.randomUUID(),
      medication: "Creon 25,000",
      dose: "25,000 units",
      quantity: 2,
      postcode: "B5 4BU",
    });

    const snapshot = async () => {
      const { data: calls } = await db
        .from("calls")
        .select("id, pharmacy_ods, status, rank_bucket, is_bench, verdict, ended_at, extraction_attempts")
        .eq("search_id", searchId)
        .order("pharmacy_ods");
      const { data: search } = await db
        .from("searches")
        .select("status, settled_at")
        .eq("id", searchId)
        .single();
      return JSON.stringify({ calls, search });
    };
    const before = await snapshot();
    expect(before).toContain("dialing"); // the fixture board really does
    expect(before).toContain("transcript_ready"); // contain the tempting rows

    // tick well past EVERY threshold: re-extract (90s), abandon (600s),
    // and the demo board's own 14-minute deadline
    const lookups: string[] = [];
    const extracted: string[] = [];
    const conversations: ConversationLookup = async (id) => {
      lookups.push(id);
      return { ok: true, state: "in_progress" };
    };
    for (const minutes of [2, 11, 20, 45]) {
      await watchdog({
        db,
        now: new Date(Date.now() + minutes * 60_000),
        conversations,
        extractFn: async (id) => void extracted.push(id),
      });
    }

    const after = await snapshot();
    expect(after).toBe(before); // not one row moved

    // and the demo board never reached the provider or the extractor
    const { data: demoCallIds } = await db
      .from("calls")
      .select("id, conversation_id")
      .eq("search_id", searchId);
    const demoIds = new Set((demoCallIds ?? []).map((c) => c.id));
    const demoConvIds = new Set(
      (demoCallIds ?? []).map((c) => c.conversation_id).filter(Boolean) as string[],
    );
    expect(extracted.filter((id) => demoIds.has(id))).toEqual([]);
    expect(lookups.filter((id) => demoConvIds.has(id))).toEqual([]);
  });
});
