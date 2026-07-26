/**
 * 5.0 — seed REAL pharmacies from the NHS Directory of Healthcare Services
 * API v3 (the architecture's `seed_pharmacies` command, finally built).
 *
 * Run with:  npm run seed:nhs -- --postcode "B5 4BU" [flags]
 *
 * Flags:
 *   --postcode "B5 4BU"     search origin (required unless --verify/--from-file)
 *   --radius-km 5           server+client radius trim (default 5)
 *   --top 50                max results to fetch (default 50, API page cap)
 *   --env int               NHS env: sandbox | int | prod (default int)
 *   --from-file path.json   skip the API; read NHS-shaped organisations from a
 *                           file ({"value":[...]} or [...]) — the key-less fallback
 *   --dry-run               normalize + report, write nothing
 *   --local                 target the LOCAL 555xx stack instead of cloud
 *   --verify FA512,FX111    flip verified=true for these ODS codes (08:30 step)
 *
 * Politeness invariants preserved by construction:
 * - rows land `verified: false`, `source: 'nhs_api'` — REAL mode dials only
 *   after the human spot-call flips `verified` (--verify)
 * - unusable hours seed as `{}` (never open, never dialed) and are REPORTED
 * - re-runs upsert by ods_code and NEVER touch an existing `verified` flag
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./env-local";
import {
  normalizeNhsOrganisation,
  type NhsOrganisation,
  type NormalizedPharmacy,
} from "../lib/domain/nhs";
import { isOpenAt, staysOpenFor, londonClock, type OpeningHours } from "../lib/domain/opening-hours";
import { searchPharmaciesNear, type NhsEnv } from "../lib/integrations/nhs";
import { geocodePostcodeServer } from "../lib/integrations/geocode";
import { distanceMiles } from "../lib/domain/geo";

const KM_PER_MILE = 1.60934;
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
  const db = has("local")
    ? createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } })
    : createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
  const target = has("local") ? "LOCAL stack" : "CLOUD";

  // ── verify mode: the 08:30 spot-call flips ────────────────────────────────
  const verify = arg("verify");
  if (verify) {
    const odsCodes = verify.split(",").map((s) => s.trim()).filter(Boolean);
    const { data, error } = await db
      .from("pharmacies")
      .update({ verified: true })
      .in("ods_code", odsCodes)
      .select("ods_code, name, phone");
    if (error) throw new Error(error.message);
    console.log(`verified=true on ${target}:`);
    for (const row of data ?? []) console.log(`  ✓ ${row.ods_code}  ${row.name}  ${row.phone}`);
    const missing = odsCodes.filter((o) => !(data ?? []).some((r) => r.ods_code === o));
    if (missing.length) {
      console.error(`NOT FOUND (not flipped): ${missing.join(", ")}`);
      process.exit(1);
    }
    return;
  }

  // ── fetch (API or file) ───────────────────────────────────────────────────
  const radiusKm = Number(arg("radius-km") ?? 5);
  let organisations: NhsOrganisation[];
  let origin: { lat: number; lng: number } | null = null;

  const postcode = arg("postcode");
  if (postcode) {
    origin = await geocodePostcodeServer(postcode);
    if (!origin) throw new Error(`could not geocode "${postcode}"`);
  }

  const fromFile = arg("from-file");
  if (fromFile) {
    const parsed = JSON.parse(readFileSync(fromFile, "utf8")) as
      | { value?: NhsOrganisation[] }
      | NhsOrganisation[];
    organisations = Array.isArray(parsed) ? parsed : (parsed.value ?? []);
    console.log(`read ${organisations.length} organisations from ${fromFile}`);
  } else {
    if (!origin) throw new Error("--postcode is required when fetching from the API");
    const nhsEnv = (arg("env") ?? "int") as NhsEnv;
    organisations = await searchPharmaciesNear({
      lat: origin.lat,
      lng: origin.lng,
      radiusKm,
      top: Number(arg("top") ?? 50),
      env: nhsEnv,
      apiKey: env.NHS_DOHS_API_KEY,
    });
    console.log(`NHS DoHS (${nhsEnv}) returned ${organisations.length} organisations`);
  }

  // ── normalize (fail closed) ───────────────────────────────────────────────
  const rows: NormalizedPharmacy[] = [];
  const dropped: string[] = [];
  const warnings: string[] = [];
  for (const org of organisations) {
    const { row, issues } = normalizeNhsOrganisation(org);
    if (!row) {
      dropped.push(`${org.ODSCode ?? "?"} ${org.OrganisationName ?? "?"} — ${issues.join("; ")}`);
      continue;
    }
    if (
      origin &&
      distanceMiles(origin, { lat: row.lat, lng: row.lng }) * KM_PER_MILE > radiusKm
    ) {
      dropped.push(`${row.ods_code} ${row.name} — outside ${radiusKm}km (client check)`);
      continue;
    }
    if (issues.length) warnings.push(`${row.ods_code} ${row.name} — ${issues.join("; ")}`);
    rows.push(row);
  }

  // ── report: what would TODAY's claim see? ─────────────────────────────────
  const now = new Date();
  const { day } = londonClock(now);
  console.log(`\n${rows.length} community pharmacies normalized (today = ${day.toUpperCase()}):`);
  for (const row of rows) {
    const todaySessions = (row.hours as OpeningHours)[day] ?? [];
    const sessions = todaySessions.length
      ? todaySessions.map(([o, c]) => `${o}–${c}`).join(", ")
      : "CLOSED today";
    const dialable =
      isOpenAt(row.hours, now) && staysOpenFor(row.hours, 60, now) ? "DIALABLE now" : "not dialable now";
    console.log(
      `  ${row.ods_code.padEnd(7)} ${row.name.slice(0, 38).padEnd(40)} ${row.phone.padEnd(14)} ${row.ownership_group.padEnd(12)} ${sessions.padEnd(24)} ${dialable}`,
    );
  }
  if (warnings.length) {
    console.log(`\nwarnings (seeded but can NEVER dial until fixed):`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
  if (dropped.length) {
    console.log(`\ndropped (not seeded):`);
    for (const d of dropped) console.log(`  ✗ ${d}`);
  }

  if (has("dry-run")) {
    console.log(`\nDRY RUN — nothing written to ${target}.`);
    return;
  }
  if (rows.length === 0) {
    console.error("\nnothing to seed — refusing to continue");
    process.exit(1);
  }

  // ── write: INSERT new rows (verified=false), UPDATE existing rows WITHOUT
  // touching verified — a re-run after the 08:30 spot-calls must never
  // un-verify anything ─────────────────────────────────────────────────────
  const { data: existingRows, error: existingError } = await db
    .from("pharmacies")
    .select("ods_code")
    .in("ods_code", rows.map((r) => r.ods_code));
  if (existingError) throw new Error(existingError.message);
  const existing = new Set((existingRows ?? []).map((r) => r.ods_code));

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (existing.has(row.ods_code)) {
      const { verified: _keepExisting, ...updatable } = row;
      const { error } = await db
        .from("pharmacies")
        .update(updatable)
        .eq("ods_code", row.ods_code);
      if (error) throw new Error(`${row.ods_code}: ${error.message}`);
      updated++;
    } else {
      const { error } = await db.from("pharmacies").insert(row);
      if (error) throw new Error(`${row.ods_code}: ${error.message}`);
      inserted++;
    }
  }
  console.log(
    `\nseeded to ${target}: ${inserted} inserted (verified=false), ${updated} updated (verified untouched). source='nhs_api'.`,
  );
  console.log(`spot-call then flip with:  npm run seed:nhs -- --verify ODS1,ODS2${has("local") ? " --local" : ""}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
