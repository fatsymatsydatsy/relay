// 4.3 two-browser test helper (+ generally useful for demo-day B-roll):
// flip ONE fixture row on ONE demo board so exactly one browser session
// should see its board move. DEMO searches can never dial — this is a
// cosmetic state change on fake data, fully reversible.
//
//   node scripts/demo-board-poke.mjs <search-id> [ods=FAKE09] [status=dialing]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [searchId, ods = "FAKE09", status = "dialing"] = process.argv.slice(2);
if (!searchId) {
  console.error("usage: node scripts/demo-board-poke.mjs <search-id> [ods] [status]");
  process.exit(1);
}
const ALLOWED = new Set(["queued", "dialing", "transcript_ready"]);
if (!ALLOWED.has(status)) {
  console.error(`status must be one of ${[...ALLOWED].join(", ")} (cosmetic, verdict-free states only)`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// guard: only DEMO boards may be poked
const { data: search, error: sErr } = await db
  .from("searches")
  .select("id, dial_mode")
  .eq("id", searchId)
  .single();
if (sErr || !search) throw new Error(`search not found: ${sErr?.message}`);
if (search.dial_mode !== "DEMO") throw new Error(`refusing: ${searchId} is ${search.dial_mode}, not DEMO`);

const patch =
  status === "dialing"
    ? { status, dial_mode: "DEV_TEST", claimed_at: new Date().toISOString() }
    : { status };
const { data, error } = await db
  .from("calls")
  .update(patch)
  .eq("search_id", searchId)
  .eq("pharmacy_ods", ods)
  .select("pharmacy_ods, status");
if (error) throw new Error(error.message);
console.log(
  data?.length
    ? `poked ${searchId.slice(0, 8)}…: ${data[0].pharmacy_ods} → ${data[0].status}`
    : `no row matched (${ods} on ${searchId.slice(0, 8)}…)`,
);
