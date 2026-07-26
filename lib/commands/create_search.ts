import { serviceClient } from "@/lib/integrations/supabase";
import {
  ALL_DAY_HOURS,
  DEMO_MEDICATION,
  FIXTURE_CALLS,
  FIXTURE_PHARMACIES,
} from "@/lib/domain/demo-fixtures";

/**
 * PHASE-1 STUB of the create_search command (architecture doc row 1).
 *
 * Real shape arrives in 3.1 (geocode → portfolio scorer → queue + bench →
 * dispatch). The stub materializes the fixture board — one call per UI state —
 * OWNED BY THE CALLER, so the RLS-scoped realtime board (1.5) renders and
 * updates it live. Commands are the only writers (golden rule): this file is
 * the single write path for the stub search, and it never dials anything.
 */

export interface CreateSearchInput {
  owner: string;
  medication: string;
  dose: string;
  quantity: number;
  postcode: string;
}

export async function createSearchStub(
  input: CreateSearchInput,
): Promise<{ searchId: string }> {
  const db = serviceClient();

  // Idempotent per session: one active demo search at a time (a light version
  // of the 4.4 abuse guard); re-submitting reuses it.
  const { data: existing } = await db
    .from("searches")
    .select("id")
    .eq("owner", input.owner)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (existing) return { searchId: existing.id };

  const { error: medError } = await db.from("medications").upsert(
    {
      id: DEMO_MEDICATION.id,
      name: DEMO_MEDICATION.name,
      strength: DEMO_MEDICATION.strength,
      form: DEMO_MEDICATION.form,
      display: DEMO_MEDICATION.display,
    },
    { onConflict: "id" },
  );
  if (medError) throw new Error(`medication upsert: ${medError.message}`);

  const { error: pharmacyError } = await db.from("pharmacies").upsert(
    FIXTURE_PHARMACIES.map((p) => ({
      ods_code: p.ods,
      name: p.name,
      address: p.address,
      postcode: p.postcode,
      phone: p.phone,
      lat: p.lat,
      lng: p.lng,
      hours: ALL_DAY_HOURS,
      ownership_group: p.ownership_group,
      is_supermarket: p.is_supermarket,
      verified: false,
      number_type: "geographic",
      source: "dev_test",
    })),
    { onConflict: "ods_code" },
  );
  if (pharmacyError) throw new Error(`pharmacy upsert: ${pharmacyError.message}`);

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  const { data: search, error: searchError } = await db
    .from("searches")
    .insert({
      owner: input.owner,
      medication_id: DEMO_MEDICATION.id,
      quantity_needed: input.quantity,
      postcode: input.postcode,
      radius_km: 5,
      status: "active",
      created_at: minutesAgo(6),
      deadline_at: new Date(now + 14 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (searchError || !search) {
    throw new Error(`search insert: ${searchError?.message ?? "no row"}`);
  }

  const { error: callsError } = await db.from("calls").insert(
    FIXTURE_CALLS.map((c) => ({
      search_id: search.id,
      pharmacy_ods: c.ods,
      status: c.status,
      rank_bucket: c.rank_bucket,
      location_confirmed: c.location_confirmed,
      dial_mode: c.dialed ? "DEV_TEST" : null,
      claimed_at: c.dialed ? minutesAgo(5) : null,
      verdict: c.verdict,
      verdict_at: c.verdictMinutesAgo != null ? minutesAgo(c.verdictMinutesAgo) : null,
      ended_at: c.endedMinutesAgo != null ? minutesAgo(c.endedMinutesAgo) : null,
      created_at: minutesAgo(6),
    })),
  );
  if (callsError) throw new Error(`calls insert: ${callsError.message}`);

  return { searchId: search.id };
}
