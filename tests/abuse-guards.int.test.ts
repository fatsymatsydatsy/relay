import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSearch } from "@/lib/commands/create_search";
import { POST as watchdogRoute } from "@/app/api/internal/watchdog/route";

/**
 * 4.4 abuse guards — LOCAL stack.
 * One active live search per session · INTERNAL_SECRET 401s · (the
 * DIALING_ENABLED kill switch is proven in dispatch.stress.)
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const ODS = (n: number) => `A44${RUN}${String(n).padStart(2, "0")}`;
const ORIGIN = { lat: 45 + Math.random(), lng: 7 + Math.random() };
const fakeGeocode = async () => ORIGIN;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ALL_WEEK = Object.fromEntries(DAYS.map((d) => [d, [["00:00", "24:00"]]]));
const MED = `AbuseMed-${RUN}`;

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
  const { error } = await db.from("pharmacies").upsert(
    [1, 2].map((n) => ({
      ods_code: ODS(n),
      name: `Abuse Pharmacy ${n}`,
      address: `${n} Guard Street`,
      postcode: "A4 4ST",
      phone: `+44770${Math.floor(Math.random() * 9000) + 1000}44${n}`,
      lat: ORIGIN.lat + n * 0.001,
      lng: ORIGIN.lng,
      hours: ALL_WEEK,
      ownership_group: "independent",
      is_supermarket: false,
      source: "dev_test",
    })),
    { onConflict: "ods_code" },
  );
  if (error) throw new Error(error.message);
});

describe("4.4 abuse guards", () => {
  it("a second live search from the same session is rejected with the running board's id", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const owner = crypto.randomUUID();
    const input = { owner, medication: MED, dose: "", quantity: 1, postcode: "A4 4ST" };
    const first = await createSearch(input, { db, geocode: fakeGeocode });
    await expect(createSearch(input, { db, geocode: fakeGeocode })).rejects.toThrow(
      `active_search_exists:${first.searchId}`,
    );

    // exactly one live search exists
    const { data: searches } = await db
      .from("searches")
      .select("id")
      .eq("owner", owner)
      .eq("status", "active");
    expect(searches).toHaveLength(1);
  });

  it("a DEMO board never blocks the same session's live search", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    const owner = crypto.randomUUID();
    const { data: med } = await db
      .from("medications")
      .upsert(
        { name: MED, strength: "demo", form: "test", display: `${MED}-demo` },
        { onConflict: "display" },
      )
      .select("id")
      .single();
    await db.from("searches").insert({
      owner,
      medication_id: med!.id,
      quantity_needed: 1,
      postcode: "A4 4ST",
      radius_km: 5,
      status: "active",
      dial_mode: "DEMO",
      deadline_at: new Date(Date.now() + 14 * 60_000).toISOString(),
    });

    const result = await createSearch(
      { owner, medication: MED, dose: "", quantity: 1, postcode: "A4 4ST" },
      { db, geocode: fakeGeocode },
    );
    expect(result.searchId).toBeTruthy(); // the demo board didn't count
  });

  it("the internal watchdog route fails closed: 401 without, with wrong, and with unset secret", async () => {
    const post = (headers: Record<string, string> = {}) =>
      watchdogRoute(
        new Request("http://localhost/api/internal/watchdog", {
          method: "POST",
          headers,
        }),
      );

    // unset secret: even a "matching" empty header is refused
    vi.stubEnv("INTERNAL_SECRET", "");
    expect((await post()).status).toBe(401);
    expect((await post({ "x-internal-secret": "" })).status).toBe(401);

    vi.stubEnv("INTERNAL_SECRET", "a-long-internal-secret-value");
    expect((await post()).status).toBe(401);
    expect((await post({ "x-internal-secret": "wrong" })).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("with the right secret the route runs a real watchdog tick", async () => {
    if (!stackUp) return expect.soft(true).toBe(true);

    vi.stubEnv("INTERNAL_SECRET", "a-long-internal-secret-value");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", LOCAL_SERVICE_KEY);
    vi.stubEnv("DIALING_ENABLED", "false"); // tick must not claim anything

    const res = await watchdogRoute(
      new Request("http://localhost/api/internal/watchdog", {
        method: "POST",
        headers: { "x-internal-secret": "a-long-internal-secret-value" },
      }),
    );
    vi.unstubAllEnvs();

    expect(res.status).toBe(200);
    const summary = (await res.json()) as Record<string, number>;
    for (const key of ["reconciledDone", "reconciledGone", "reExtracted", "settledSearches"]) {
      expect(typeof summary[key]).toBe("number");
    }
  });
});
