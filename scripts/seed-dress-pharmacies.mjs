#!/usr/bin/env node
/**
 * 3.6 dress-rehearsal pharmacies — a FRESH fake area (central Cambridge,
 * search postcode CB2 1TN) so the dress runs live dials immediately: the B5
 * set is politeness-locked + verdict-cached for an hour after any run, and
 * cache copies (correctly) replace dials.
 *
 * 10 × 24/7 DEV_TEST pharmacies, drama-range numbers, never dialed before.
 * Idempotent upsert against the project in .env.local (cloud).
 *
 *   node scripts/seed-dress-pharmacies.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = (n) =>
  process.env[n] ??
  readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${n}=`))
    ?.slice(n.length + 1)
    .trim();

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const ALL_DAY = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["00:00", "24:00"]]]),
);

// ringed around CB2 1TN (52.2053, 0.1218)
const ROWS = [
  ["FAKE11", "Mill Road Pharmacy", "72 Mill Road", "CB1 2AS", 52.2009, 0.1355, "independent", false],
  ["FAKE12", "Trumpington St Chemist", "14 Trumpington Street", "CB2 1QA", 52.2001, 0.118, "independent", false],
  ["FAKE13", "Regent Pharmacy", "55 Regent Street", "CB2 1AB", 52.1985, 0.125, "independent", false],
  ["FAKE14", "Hills Road Pharmacy", "103 Hills Road", "CB2 1PG", 52.1932, 0.1315, "camchain", false],
  ["FAKE15", "Station Road Chemist", "8 Station Road", "CB1 2JB", 52.1943, 0.1372, "camchain", false],
  ["FAKE16", "Chesterton Pharmacy", "21 Chesterton Road", "CB4 3AN", 52.2126, 0.1181, "independent", false],
  ["FAKE17", "Sainsburys Pharmacy", "44 Sidney Street", "CB2 3HX", 52.2069, 0.1215, "sainsburys", true],
  ["FAKE18", "Newnham Chemist", "5 Newnham Road", "CB3 9EY", 52.199, 0.108, "independent", false],
  ["FAKE19", "East Road Pharmacy", "90 East Road", "CB1 1BG", 52.2042, 0.1334, "independent", false],
  ["FAKE20", "Castle Hill Pharmacy", "3 Castle Street", "CB3 0AH", 52.2118, 0.1141, "independent", false],
];

const { error } = await db.from("pharmacies").upsert(
  ROWS.map(([ods, name, address, postcode, lat, lng, group, market], i) => ({
    ods_code: ods,
    name,
    address,
    postcode,
    phone: `+4477009000${11 + i}`,
    lat,
    lng,
    hours: ALL_DAY,
    ownership_group: group,
    is_supermarket: market,
    verified: false,
    number_type: "geographic",
    source: "dev_test",
  })),
  { onConflict: "ods_code" },
);
if (error) throw new Error(error.message);
console.log("10 dress pharmacies upserted (FAKE11–FAKE20, Cambridge / CB2 1TN)");
