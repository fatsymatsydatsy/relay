/**
 * 5.1 — set `verified` from NHS directory data + quality gates.
 *
 *   npx tsx scripts/verify-nhs-pharmacies.ts [--apply] [--local]
 *                                            [--area +44121] [--all-week]
 *
 * Default is a DRY RUN: it prints exactly which pharmacies would be verified
 * and which are rejected, with the reason. `--apply` writes.
 *
 * What `verified` means after this (build-steps 5.1, criterion changed
 * 26 Jul): "the NHS directory lists this as a community pharmacy at this
 * number with these hours, and it passed the gates below" — NOT "a human
 * reached this branch". The politeness invariants do not depend on this
 * flag: open-now + stays-open-60min, one-dial-per-number-per-hour, caps and
 * the attempt ceiling all live inside the advisory-locked claim.
 *
 * Gates (each rejection is printed, never silent):
 *   1. source = 'nhs_api'      — never a dev_test fixture
 *   2. geographic local number — an out-of-area code means a central
 *      switchboard, not the branch (caught Tesco Instore's 01245 Chelmsford
 *      line, exactly what a spot-call was supposed to catch)
 *   3. open TODAY              — a pharmacy with no hours today can't serve
 *      the run (relax with --all-week)
 *   4. hours parse cleanly     — validated by the same domain code the
 *      claim uses; junk hours can never open a pharmacy
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./env-local";
import { londonClock, validateHours, type OpeningHours } from "../lib/domain/opening-hours";

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
  const areaPrefix = arg("area") ?? "+44121";
  const requireToday = !has("all-week");
  const { day } = londonClock(new Date());

  const { data: rows, error } = await db
    .from("pharmacies")
    .select("ods_code, name, phone, hours, source, verified")
    .eq("source", "nhs_api");
  if (error) throw new Error(error.message);

  const pass: typeof rows = [];
  const reject: { ods: string; name: string; why: string }[] = [];

  for (const p of rows ?? []) {
    const hours = p.hours as OpeningHours;
    const invalid = validateHours(hours);
    if (invalid) {
      reject.push({ ods: p.ods_code, name: p.name, why: `unusable hours (${invalid})` });
    } else if (!p.phone.startsWith(areaPrefix)) {
      reject.push({
        ods: p.ods_code,
        name: p.name,
        why: `out-of-area number ${p.phone} — likely a central line, not the branch`,
      });
    } else if (requireToday && (hours[day] ?? []).length === 0) {
      reject.push({ ods: p.ods_code, name: p.name, why: `closed all day ${day.toUpperCase()}` });
    } else {
      pass.push(p);
    }
  }

  console.log(`NHS-sourced pharmacies: ${rows?.length ?? 0}  ·  today = ${day.toUpperCase()}`);
  console.log(`\nVERIFY (${pass.length}):`);
  for (const p of pass) {
    const sessions = ((p.hours as OpeningHours)[day] ?? [])
      .map(([o, c]) => `${o}-${c}`)
      .join(", ");
    const already = p.verified ? " (already verified)" : "";
    console.log(
      `  ${p.ods_code.padEnd(7)} ${p.name.slice(0, 34).padEnd(36)} ${p.phone}  ${sessions}${already}`,
    );
  }
  console.log(`\nREJECT (${reject.length}):`);
  for (const r of reject) {
    console.log(`  ${r.ods.padEnd(7)} ${r.name.slice(0, 34).padEnd(36)} ${r.why}`);
  }

  if (!has("apply")) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to set verified=true.`);
    return;
  }
  if (pass.length === 0) {
    console.error("\nnothing passes the gates — refusing to continue");
    process.exit(1);
  }

  const { error: upErr } = await db
    .from("pharmacies")
    .update({ verified: true })
    .in(
      "ods_code",
      pass.map((p) => p.ods_code),
    );
  if (upErr) throw new Error(upErr.message);

  // rejected rows must never be left verified from an earlier, looser run
  if (reject.length) {
    const { error: downErr } = await db
      .from("pharmacies")
      .update({ verified: false })
      .in(
        "ods_code",
        reject.map((r) => r.ods),
      );
    if (downErr) throw new Error(downErr.message);
  }
  console.log(
    `\napplied to ${local ? "LOCAL" : "CLOUD"}: ${pass.length} verified, ${reject.length} held back.`,
  );
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
