import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedAreaPharmacies } from "@/lib/commands/seed_area_pharmacies";
import { createSearch } from "@/lib/commands/create_search";
import type { NhsOrganisation } from "@/lib/domain/nhs";
import type { OpeningHours } from "@/lib/domain/opening-hours";

/**
 * 5.2b — live NHS area fetch at search time (national coverage). LOCAL stack
 * only (skips when down). The fixture is the 5.0.2 sample: 3 usable
 * community pharmacies + 1 DSP that must drop. ODS codes are re-suffixed
 * per run so re-runs and other suites can never collide.
 */
const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUF = String(Math.floor(Math.random() * 90000) + 10000);
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/nhs-organisations-sample.json"), "utf8"),
) as { value: NhsOrganisation[] };
/** X99001 → SA<suffix>01 etc. — per-run unique, everything else untouched. */
const orgs = (suffix: string): NhsOrganisation[] =>
  fixture.value.map((o) => ({ ...o, ODSCode: (o.ODSCode ?? "").replace("X99", `SA${suffix}`) }));

// Per-run random geography (same trick as create-search suite): nothing from
// other suites can fall inside this radius.
const ORIGIN = { lat: 52 + Math.random() * 1.5, lng: -1 - Math.random() * 1.5 };
const fakeGeocode = async () => ORIGIN;
const DAY = new Date("2026-01-26T10:00:00Z"); // Mon 10:00 London
const ALL_WEEK: OpeningHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["00:00", "24:00"]]]),
);

let db: SupabaseClient;
let stackUp = false;

async function localStackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_URL}/rest/v1/`, {
      headers: { apikey: LOCAL_SERVICE_KEY },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  stackUp = await localStackUp();
  if (!stackUp) {
    console.warn("⚠ local supabase stack is down — seed-area int tests SKIPPED");
    return;
  }
  db = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });
});

afterAll(async () => {
  // pharmacies rows persist like other suites' fixtures (dial_log FKs make
  // deletes unreliable); per-run ODS + geography keep everything hermetic.
});

describe("seedAreaPharmacies (5.2b)", () => {
  it("inserts usable rows verified=true and drops junk, fail-closed", async () => {
    if (!stackUp) return;
    const result = await seedAreaPharmacies(
      { lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 5 },
      { db, fetchOrgs: async () => orgs(SUF) },
    );
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(3); // DSP dropped
    expect(result.dropped).toBe(1);

    const { data: rows } = await db
      .from("pharmacies")
      .select("ods_code, verified, source, phone, hours")
      .like("ods_code", `SA${SUF}%`);
    expect(rows).toHaveLength(3);
    for (const r of rows ?? []) {
      expect(r.verified).toBe(true);
      expect(r.source).toBe("nhs_api");
      expect(r.phone).toMatch(/^\+44/);
      expect(Object.keys(r.hours as OpeningHours).length).toBeGreaterThan(0);
    }
  });

  it("re-run inserts nothing and NEVER touches an existing verified flag", async () => {
    if (!stackUp) return;
    const ods = `SA${SUF}001`;
    await db.from("pharmacies").update({ verified: false }).eq("ods_code", ods);

    const result = await seedAreaPharmacies(
      { lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 5 },
      { db, fetchOrgs: async () => orgs(SUF) },
    );
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.existing).toBe(3);

    const { data: row } = await db
      .from("pharmacies")
      .select("verified")
      .eq("ods_code", ods)
      .single();
    expect(row?.verified).toBe(false); // a human/gate decision sticks
  });

  it("fetcher failure writes nothing and reports ok:false — search can proceed on DB", async () => {
    if (!stackUp) return;
    const suffix = String(Number(SUF) + 1);
    const result = await seedAreaPharmacies(
      { lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 5 },
      {
        db,
        fetchOrgs: async () => {
          throw new Error("NHS 503");
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.inserted).toBe(0);
    const { data: rows } = await db
      .from("pharmacies")
      .select("ods_code")
      .like("ods_code", `SA${suffix}%`);
    expect(rows).toHaveLength(0);
  });

  it("missing API key → graceful noop, no network", async () => {
    const saved = process.env.NHS_DOHS_API_KEY;
    delete process.env.NHS_DOHS_API_KEY;
    try {
      const result = await seedAreaPharmacies({ lat: 52, lng: -1, radiusKm: 5 });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("no_api_key");
      expect(result.inserted).toBe(0);
    } finally {
      if (saved !== undefined) process.env.NHS_DOHS_API_KEY = saved;
    }
  });
});

describe("create_search wiring (5.2b)", () => {
  const OWNER = crypto.randomUUID();
  const seededOds = `SA${SUF}W1`;

  beforeAll(async () => {
    if (!stackUp) return;
    await db.from("pharmacies").upsert({
      ods_code: seededOds,
      name: "Wiring Test Pharmacy",
      address: "1 Test St",
      postcode: "T1 1AA",
      phone: "+441214960999",
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      hours: ALL_WEEK,
      verified: true,
      // the wiring tests run a DEV_TEST search, whose pool (3.7 mode
      // isolation) only sees dev_test rows
      source: "dev_test",
      number_type: "geographic",
      is_supermarket: false,
      ownership_group: "independent",
    });
  });

  it("calls seedArea between geocode and ranking, with the searched origin", async () => {
    if (!stackUp) return;
    const seen: { lat: number; lng: number; radiusKm: number }[] = [];
    const result = await createSearch(
      {
        owner: OWNER,
        medication: `SeedAreaMed-${SUF}`,
        dose: "10mg",
        quantity: 1,
        postcode: "T1 1AA",
      },
      {
        db,
        geocode: fakeGeocode,
        now: DAY,
        dialMode: "DEV_TEST",
        seedArea: async (args) => {
          seen.push(args);
          return { ok: true };
        },
      },
    );
    expect(result.searchId).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 5 });
    // settle the board so the one-active-per-owner guard frees up
    await db
      .from("searches")
      .update({ status: "complete", settled_at: new Date().toISOString() })
      .eq("id", result.searchId);
  });

  it("a throwing seedArea does not break the search — DB rows still rank", async () => {
    if (!stackUp) return;
    const result = await createSearch(
      {
        owner: OWNER,
        medication: `SeedAreaMed2-${SUF}`,
        dose: "10mg",
        quantity: 1,
        postcode: "T1 1AA",
      },
      {
        db,
        geocode: fakeGeocode,
        now: DAY,
        dialMode: "DEV_TEST",
        seedArea: async () => {
          throw new Error("NHS on fire");
        },
      },
    );
    expect(result.searchId).toBeTruthy();
    expect(result.queued).toBeGreaterThan(0); // the ALL_WEEK row still ranked
  });
});
