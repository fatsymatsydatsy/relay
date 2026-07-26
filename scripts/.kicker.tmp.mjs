import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = (n) => process.env[n] ?? readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${n}=`))?.slice(n.length + 1).trim();
const service = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const now = () => new Date().toISOString();

// One realistic step per search per tick; after all four, the board completes.
const STEPS = [
  { ods: "FAKE09", from: "queued", set: { status: "dialing", dial_mode: "DEV_TEST", claimed_at: now() } },
  { ods: "FAKE06", from: "dialing", set: { status: "verdict", rank_bucket: 1, location_confirmed: "yes", verdict: { stock_status: "in_stock", quantity_available: 3, quantity_unit: "boxes", eta: null, notes: null }, verdict_at: now(), ended_at: now() } },
  { ods: "FAKE07", from: "transcript_ready", set: { status: "verdict", rank_bucket: 3, location_confirmed: "yes", verdict: { stock_status: "out_of_stock", quantity_available: 0, quantity_unit: "boxes", eta: null, notes: "national shortage mentioned" }, verdict_at: now(), ended_at: now() } },
  { ods: "FAKE09", from: "dialing", set: { status: "verdict", rank_bucket: 2, location_confirmed: "yes", verdict: { stock_status: "orderable", quantity_available: null, quantity_unit: null, eta: "Thursday", notes: null }, verdict_at: now(), ended_at: now() } },
];

const END = Date.now() + 6 * 60_000;
while (Date.now() < END) {
  const { data: searches } = await service.from("searches").select("id").eq("status", "active");
  for (const s of searches ?? []) {
    for (const step of STEPS) {
      const { data } = await service.from("calls").update(step.set).eq("search_id", s.id).eq("pharmacy_ods", step.ods).eq("status", step.from).select("id");
      if (data?.length) { console.log(now(), s.id.slice(0, 8), step.ods, "->", step.set.status); break; }
    }
  }
  await new Promise((r) => setTimeout(r, 8000));
}
console.log("kicker window closed");
