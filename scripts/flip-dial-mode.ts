/**
 * 4.5 — the DIAL_MODE flip ritual (runbook 09:00 step).
 *
 * Run with:  npx tsx scripts/flip-dial-mode.ts [--local]
 *
 * Cancels every non-terminal row of every non-DEMO search (advisory-locked
 * `flip_cancel_non_terminal`) so the flip starts from a clean slate, then
 * prints the remaining manual step: DIAL_MODE is a Vercel env var — the
 * code reads it at request time, so it must be changed in the dashboard
 * (or `vercel env`) and redeployed. 3.7's mode isolation means stale rows
 * could never dial across modes anyway; this is hygiene + a visible ritual.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./env-local";

const LOCAL_URL = "http://127.0.0.1:55521";
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function main() {
  const local = process.argv.includes("--local");
  const env = loadEnvLocal();
  const db = local
    ? createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } })
    : createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });

  const { data, error } = await db.rpc("flip_cancel_non_terminal", {
    p_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  const result = (data ?? [])[0] as { expired_calls: number; settled_searches: number };
  console.log(
    `flip sweep on ${local ? "LOCAL" : "CLOUD"}: ${result.expired_calls} rows expired, ${result.settled_searches} searches completed (DEMO boards untouched).`,
  );
  console.log(`\nnow flip the mode itself (env is read at request time):`);
  console.log(`  1. Vercel → medfind → Settings → Environment Variables → DIAL_MODE=REAL`);
  console.log(`  2. redeploy:  vercel deploy --prod --yes`);
  console.log(`  3. verify:    node scripts/verify-deploy.mjs`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
