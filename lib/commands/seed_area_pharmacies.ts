/**
 * 5.2b — ensure the searched area has NHS pharmacies, at search time.
 *
 * Called by create_search between geocode and ranking (national coverage:
 * "the NHS API should be called to search the area for the postcode
 * entered" — Marvin, 26 Jul). One NHS DoHS fetch at the searched point,
 * fail-closed normalize, then INSERT ONLY THE MISSING rows:
 *
 *  - rows that survive normalization AND have usable hours land
 *    `verified: true` — same 5.1 semantics ("the NHS directory lists this
 *    community pharmacy at this number with these hours"); rows missing a
 *    phone or hours are never written at all.
 *  - existing rows are NEVER updated here — a human/gate `verified`
 *    decision sticks, and the search path stays one INSERT away from fast.
 *  - any failure (no key, timeout, 5xx, junk body) returns ok:false and the
 *    search proceeds on whatever the DB already has — fail-closed to
 *    known-good data, never a hard dependency on a third party mid-search.
 *
 * Politeness invariants are untouched: open-now, stay-open-60min, one dial
 * per number per hour, caps and the attempt ceiling all live inside the
 * advisory-locked claim (dispatch), which reads these rows like any others.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/integrations/supabase";
import { searchPharmaciesNear, type NhsEnv } from "@/lib/integrations/nhs";
import { normalizeNhsOrganisation, type NhsOrganisation } from "@/lib/domain/nhs";

export interface SeedAreaArgs {
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface SeedAreaDeps {
  db?: SupabaseClient;
  /** Injected in tests; default is the live NHS DoHS client (5s timeout). */
  fetchOrgs?: (args: SeedAreaArgs) => Promise<NhsOrganisation[]>;
}

export interface SeedAreaResult {
  ok: boolean;
  reason?: string;
  fetched: number;
  /** normalized + hours usable → candidates for insert */
  usable: number;
  inserted: number;
  existing: number;
  dropped: number;
}

const zero = (ok: boolean, reason?: string): SeedAreaResult => ({
  ok,
  reason,
  fetched: 0,
  usable: 0,
  inserted: 0,
  existing: 0,
  dropped: 0,
});

function defaultFetcher(args: SeedAreaArgs): Promise<NhsOrganisation[]> {
  const env = (process.env.NHS_DOHS_ENV ?? "int") as NhsEnv;
  return searchPharmaciesNear({
    lat: args.lat,
    lng: args.lng,
    radiusKm: args.radiusKm,
    top: 50,
    env,
    apiKey: process.env.NHS_DOHS_API_KEY,
    // a slow directory must never hold a patient's search hostage
    fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
  });
}

export async function seedAreaPharmacies(
  args: SeedAreaArgs,
  deps: SeedAreaDeps = {},
): Promise<SeedAreaResult> {
  let organisations: NhsOrganisation[];
  try {
    if (!deps.fetchOrgs && !process.env.NHS_DOHS_API_KEY) {
      return zero(false, "no_api_key");
    }
    organisations = await (deps.fetchOrgs ?? defaultFetcher)(args);
  } catch (err) {
    return zero(false, `fetch_failed: ${String(err).slice(0, 120)}`);
  }

  // Fail-closed normalize; only rows with a real phone AND usable hours are
  // worth writing — anything else could never pass the claim's dialable
  // check anyway, so garbage never enters the table.
  const usable = organisations
    .map((org) => normalizeNhsOrganisation(org).row)
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => Object.values(row.hours).some((sessions) => (sessions ?? []).length > 0));
  const dropped = organisations.length - usable.length;
  if (usable.length === 0) {
    return { ...zero(true), fetched: organisations.length, dropped };
  }

  // db resolved only past this point — the no-key/no-data paths never need it
  const db = deps.db ?? serviceClient();
  const odsCodes = usable.map((r) => r.ods_code);
  const { data: existingRows, error: selErr } = await db
    .from("pharmacies")
    .select("ods_code")
    .in("ods_code", odsCodes);
  if (selErr) return zero(false, `select_failed: ${selErr.message}`);
  const existing = new Set((existingRows ?? []).map((r) => r.ods_code));

  const toInsert = usable
    .filter((r) => !existing.has(r.ods_code))
    .map((r) => ({ ...r, verified: true as const }));
  if (toInsert.length > 0) {
    const { error: insErr } = await db.from("pharmacies").insert(toInsert);
    if (insErr) return zero(false, `insert_failed: ${insErr.message}`);
  }

  return {
    ok: true,
    fetched: organisations.length,
    usable: usable.length,
    inserted: toInsert.length,
    existing: existing.size,
    dropped,
  };
}
