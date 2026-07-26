/**
 * 5.2b ops probe — what would the live path seed for this postcode?
 *
 *   npx tsx scripts/probe-area-fetch.ts "M1 2AB" [--cloud]
 *
 * Runs the REAL production path pieces by hand: geocode (postcodes.io) →
 * seedAreaPharmacies with the default NHS DoHS fetcher (Marvin's int key
 * from .env.local) → prints counts + a sample. Writes to LOCAL unless
 * --cloud is passed; inserts are missing-rows-only either way.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./env-local";
import { seedAreaPharmacies } from "../lib/commands/seed_area_pharmacies";
import { geocodePostcodeServer } from "../lib/integrations/geocode";

const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function main() {
  const env = loadEnvLocal();
  process.env.NHS_DOHS_API_KEY = env.NHS_DOHS_API_KEY;
  process.env.NHS_DOHS_ENV = env.NHS_DOHS_ENV ?? "int";

  const postcode = process.argv[2];
  if (!postcode) throw new Error(`usage: probe-area-fetch.ts "M1 2AB" [--cloud]`);
  const cloud = process.argv.includes("--cloud");
  const db = cloud
    ? createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      })
    : createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } });

  const origin = await geocodePostcodeServer(postcode);
  if (!origin) throw new Error(`geocode failed for ${postcode}`);
  console.log(`${postcode} → ${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`);

  const result = await seedAreaPharmacies({ lat: origin.lat, lng: origin.lng, radiusKm: 5 }, { db });
  console.log(result);

  if (result.ok && (result.inserted || result.existing)) {
    const { data } = await db
      .from("pharmacies")
      .select("ods_code, name, phone, verified")
      .eq("source", "nhs_api")
      .order("created_at", { ascending: false })
      .limit(Math.min(result.inserted || 5, 10));
    for (const p of data ?? []) {
      console.log(`  ${p.ods_code.padEnd(7)} ${p.name.slice(0, 40).padEnd(42)} ${p.phone} v=${p.verified}`);
    }
  }
  console.log(`target: ${cloud ? "CLOUD" : "LOCAL"}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
