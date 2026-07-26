import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/integrations/supabase";
import { geocodePostcodeServer, type Geocoder } from "@/lib/integrations/geocode";
import { buildPortfolio, type Candidate } from "@/lib/domain/portfolio";
import { distanceMiles } from "@/lib/domain/geo";
import { nextOpening, type OpeningHours } from "@/lib/domain/opening-hours";

/**
 * create_search (3.1) — the REAL command (architecture doc, command table
 * row 1). One search = validate + geocode → rank ALL open pharmacies in
 * radius (portfolio scorer) → insert the queue: top-N targets + bench rows,
 * copying any <1h cached verdict instead of re-dialing (the politeness lock
 * doubles as a cache; timestamps stay the ORIGINAL confirmation time —
 * honesty over freshness). Zero open pharmacies → the search completes
 * immediately with next-opening times.
 *
 * This command only WRITES the queue — dialing belongs to dispatch (3.2),
 * which the caller invokes after this returns.
 */

export interface CreateSearchInput {
  owner: string;
  medication: string;
  dose: string;
  quantity: number;
  postcode: string; // already normalized by the route
}

export interface CreateSearchResult {
  searchId: string;
  queued: number;
  bench: number;
  cachedCopies: number;
  zeroOpen: boolean;
  /** For the zero-open path: "Boots (High St) opens sat 09:00", … */
  nextOpenings: { name: string; day: string; time: string }[];
}

export interface CreateSearchDeps {
  db?: SupabaseClient;
  geocode?: Geocoder;
  now?: Date;
  targetCount?: number;
  radiusKm?: number;
  /** Verdict-cache window in minutes (matches the politeness lock). */
  cacheWindowMinutes?: number;
  /** Searches are mode-scoped end-to-end (3.7 P1-1): the pool, the verdict
   *  cache, and the claim all see only this mode's pharmacies. */
  dialMode?: "DEV_TEST" | "REAL";
}

const KM_PER_MILE = 1.60934;

export async function createSearch(
  input: CreateSearchInput,
  deps: CreateSearchDeps = {},
): Promise<CreateSearchResult> {
  const db = deps.db ?? serviceClient();
  const geocode = deps.geocode ?? geocodePostcodeServer;
  const now = deps.now ?? new Date();
  const targetCount = deps.targetCount ?? 6;
  const radiusKm = deps.radiusKm ?? 5;
  const cacheWindowMinutes = deps.cacheWindowMinutes ?? 60;
  const dialMode =
    deps.dialMode ??
    ((process.env.DIAL_MODE ?? "DEV_TEST") as "DEV_TEST" | "REAL");

  const origin = await geocode(input.postcode);
  if (!origin) throw new Error("geocode_failed");

  // medication row: find-or-create by display (free-typed meds are allowed)
  const display = input.dose
    ? `${input.medication} ${input.dose}`
    : input.medication;
  const { data: medication, error: medError } = await db
    .from("medications")
    .upsert(
      {
        name: input.medication,
        strength: input.dose || "unspecified",
        form: "unspecified",
        display,
      },
      { onConflict: "display" },
    )
    .select("id")
    .single();
  if (medError || !medication) {
    throw new Error(`medication upsert: ${medError?.message ?? "no row"}`);
  }

  // candidate pool: dialable pharmacies inside the radius, THIS MODE ONLY
  // (3.7 P1-1: a REAL search must never rank, cache-copy, or wait on a
  // dev_test pharmacy — mode isolation starts at the pool, not at dispatch)
  const { data: pharmacies, error: pharmacyError } = await db
    .from("pharmacies")
    .select(
      "ods_code, name, lat, lng, hours, ownership_group, is_supermarket, source, verified",
    );
  if (pharmacyError || !pharmacies) {
    throw new Error(`pharmacies fetch: ${pharmacyError?.message}`);
  }
  const modeEligible = pharmacies.filter((p) =>
    dialMode === "DEV_TEST"
      ? p.source === "dev_test"
      : p.verified && p.source !== "dev_test",
  );
  const inRadius = modeEligible.filter(
    (p) =>
      distanceMiles(origin, { lat: p.lat, lng: p.lng }) * KM_PER_MILE <=
      radiusKm,
  );

  // own history per pharmacy (0.35 weight + answered-before bonus)
  const odsList = inRadius.map((p) => p.ods_code);
  const { data: historyRows } = odsList.length
    ? await db
        .from("calls")
        .select("pharmacy_ods, status")
        .in("pharmacy_ods", odsList)
    : { data: [] as { pharmacy_ods: string; status: string }[] };
  const history = new Map<string, { calls: number; verdicts: number }>();
  for (const row of historyRows ?? []) {
    const h = history.get(row.pharmacy_ods) ?? { calls: 0, verdicts: 0 };
    h.calls++;
    if (row.status === "verdict") h.verdicts++;
    history.set(row.pharmacy_ods, h);
  }

  const candidates: Candidate[] = inRadius.map((p) => ({
    ods: p.ods_code,
    distanceKm:
      distanceMiles(origin, { lat: p.lat, lng: p.lng }) * KM_PER_MILE,
    hours: p.hours as OpeningHours,
    ownershipGroup: p.ownership_group,
    isSupermarket: p.is_supermarket,
    history: history.get(p.ods_code) ?? { calls: 0, verdicts: 0 },
    answeredBefore: (history.get(p.ods_code)?.verdicts ?? 0) > 0,
  }));

  const portfolio = buildPortfolio({
    candidates,
    now,
    radiusKm,
    targetCount,
  });

  // zero open pharmacies: nothing to dial — complete immediately, tell the
  // patient when the nearest ones open instead
  if (portfolio.targets.length === 0) {
    const { data: search, error } = await db
      .from("searches")
      .insert({
        owner: input.owner,
        medication_id: medication.id,
        quantity_needed: input.quantity,
        postcode: input.postcode,
        radius_km: radiusKm,
        status: "complete",
        dial_mode: dialMode,
        deadline_at: new Date(now.getTime() + 20 * 60_000).toISOString(),
        settled_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (error || !search) throw new Error(`search insert: ${error?.message}`);

    const nextOpenings = inRadius
      .map((p) => {
        const opening = nextOpening(p.hours as OpeningHours, now);
        return opening ? { name: p.name, ...opening } : null;
      })
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .slice(0, 5);
    return {
      searchId: search.id,
      queued: 0,
      bench: 0,
      cachedCopies: 0,
      zeroOpen: true,
      nextOpenings,
    };
  }

  const { data: search, error: searchError } = await db
    .from("searches")
    .insert({
      owner: input.owner,
      medication_id: medication.id,
      quantity_needed: input.quantity,
      postcode: input.postcode,
      radius_km: radiusKm,
      status: "active",
      dial_mode: dialMode,
      deadline_at: new Date(now.getTime() + 20 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (searchError || !search) {
    throw new Error(`search insert: ${searchError?.message ?? "no row"}`);
  }

  // the verdict cache: latest verdict per target pharmacy for THIS medication
  // inside the politeness window — copied, never re-dialed. Same MODE only
  // (3.7 P1-1): a DEV_TEST verdict must never appear on a REAL board.
  const targetOds = portfolio.targets.map((t) => t.ods);
  const since = new Date(now.getTime() - cacheWindowMinutes * 60_000).toISOString();
  const { data: cached } = targetOds.length
    ? await db
        .from("calls")
        .select(
          "id, pharmacy_ods, verdict, rank_bucket, location_confirmed, verdict_at, searches!inner(medication_id, dial_mode)",
        )
        .in("pharmacy_ods", targetOds)
        .eq("status", "verdict")
        .gte("verdict_at", since)
        .order("verdict_at", { ascending: false })
    : { data: [] };
  const cacheByOds = new Map<string, NonNullable<typeof cached>[number]>();
  for (const row of cached ?? []) {
    // rows arrive newest-first; keep the first ELIGIBLE per pharmacy: the
    // verdict must be for this medication AND from a same-mode search.
    const src = row.searches as unknown as {
      medication_id: string;
      dial_mode: string;
    };
    if (src.medication_id !== medication.id || src.dial_mode !== dialMode) {
      continue;
    }
    if (!cacheByOds.has(row.pharmacy_ods)) cacheByOds.set(row.pharmacy_ods, row);
  }

  const callRows = [
    ...portfolio.targets.map((t) => {
      const cache = cacheByOds.get(t.ods);
      if (cache) {
        return {
          search_id: search.id,
          pharmacy_ods: t.ods,
          status: "verdict" as const,
          rank_bucket: cache.rank_bucket,
          location_confirmed: cache.location_confirmed,
          verdict: cache.verdict,
          verdict_at: cache.verdict_at, // ORIGINAL confirmation time — honest
          copied_from_call_id: cache.id,
          rank_score: t.score,
          is_bench: false,
        };
      }
      return {
        search_id: search.id,
        pharmacy_ods: t.ods,
        status: "queued" as const,
        rank_score: t.score,
        is_bench: false,
      };
    }),
    ...portfolio.bench.map((b) => ({
      search_id: search.id,
      pharmacy_ods: b.ods,
      status: "queued" as const,
      rank_score: b.score,
      is_bench: true,
    })),
  ];
  const { error: callsError } = await db.from("calls").insert(callRows);
  if (callsError) throw new Error(`calls insert: ${callsError.message}`);

  const cachedCopies = portfolio.targets.filter((t) =>
    cacheByOds.has(t.ods),
  ).length;

  // Every target satisfied from cache → nothing will ever dial and no webhook
  // will ever fire (audit P2-1): settle NOW — leftover bench expires, the
  // search completes, the board's tick shows a finished search.
  if (cachedCopies === portfolio.targets.length) {
    const { error: settleError } = await db.rpc("settle_if_drained", {
      p_search_id: search.id,
      p_at: now.toISOString(),
    });
    if (settleError) {
      throw new Error(`settle_if_drained: ${settleError.message}`);
    }
  }

  return {
    searchId: search.id,
    queued: portfolio.targets.length - cachedCopies,
    bench: portfolio.bench.length,
    cachedCopies,
    zeroOpen: false,
    nextOpenings: [],
  };
}
