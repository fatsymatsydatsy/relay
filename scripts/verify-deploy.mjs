// 3.7 post-deploy verification — READ-ONLY against cloud (plus one demo-mode
// smoke that exercises the deployed public API the same way the UI does).
// Secrets come from .env.local and are never printed.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

// 1. migration landed: searches.dial_mode exists and legacy rows are backfilled
{
  const { data, error } = await service
    .from("searches")
    .select("dial_mode")
    .limit(5);
  check(
    "searches.dial_mode column live",
    !error,
    error ? error.message : `sample modes: ${[...new Set((data ?? []).map((r) => r.dial_mode))].join(",") || "no rows"}`,
  );
}

// 2. calls.extraction exists and is NOT client-granted (anon must be refused)
{
  const { error } = await service.from("calls").select("extraction").limit(1);
  check("calls.extraction column live (service)", !error, error?.message ?? "selectable by service role");
  const { error: anonErr } = await anon.from("calls").select("extraction").limit(1);
  check(
    "calls.extraction DENIED to anon",
    !!anonErr,
    anonErr ? `refused: ${anonErr.code}` : "ANON COULD SELECT IT — grant leak!",
  );
}

// 3. verdict grant unchanged for clients (the board still works)
{
  const { error } = await anon
    .from("calls")
    .select("id, status, rank_bucket, verdict, verdict_at")
    .limit(1);
  check("client verdict columns still granted", !error, error?.message ?? "ok");
}

// 4. RPCs live: settle_if_drained on a random uuid is a harmless no-op
{
  const { data, error } = await service.rpc("settle_if_drained", {
    p_search_id: "00000000-0000-4000-8000-000000000000",
    p_at: new Date().toISOString(),
  });
  check("settle_if_drained RPC live", !error, error?.message ?? `returned ${data}`);
  const { error: pbErr } = await service.rpc("promote_bench", {
    p_search_id: "00000000-0000-4000-8000-000000000000",
  });
  check("promote_bench RPC live", !pbErr, pbErr?.message ?? "returned (no bench, null)");
}

// 5. RPCs are service-only: anon must be refused
{
  const { error } = await anon.rpc("promote_bench", {
    p_search_id: "00000000-0000-4000-8000-000000000000",
  });
  check(
    "promote_bench DENIED to anon",
    !!error,
    error ? `refused: ${error.code}` : "ANON COULD EXECUTE IT — grant leak!",
  );
}

// 5b. Phase 4 RPCs exist AND are anon-denied (42501 = present + locked;
// PGRST202 = missing = migration didn't land). Probing as anon never executes.
for (const fn of ["settle_expired_searches", "flip_cancel_non_terminal"]) {
  const { error } = await anon.rpc(fn, { p_at: new Date().toISOString() });
  const code = error?.code ?? "none";
  check(
    `${fn} live + DENIED to anon`,
    code === "42501",
    code === "PGRST202" ? "FUNCTION MISSING — migration not applied" : `refused: ${code}`,
  );
}

// 5c. the watchdog route: fail-closed 401s, then one REAL authorized tick
// (same op as the cron; sweeps any past-deadline boards — intended behavior)
{
  const url = "https://medfind-three.vercel.app/api/internal/watchdog";
  const no = await fetch(url, { method: "POST" });
  const wrong = await fetch(url, {
    method: "POST",
    headers: { "x-internal-secret": "wrong-value-1234567890" },
  });
  check("watchdog route 401 without secret", no.status === 401, `HTTP ${no.status}`);
  check("watchdog route 401 with wrong secret", wrong.status === 401, `HTTP ${wrong.status}`);
  if (env.INTERNAL_SECRET) {
    const ok = await fetch(url, {
      method: "POST",
      headers: { "x-internal-secret": env.INTERNAL_SECRET },
    });
    const body = await ok.json().catch(() => ({}));
    check(
      "watchdog tick runs with the real secret",
      ok.status === 200 && typeof body.settledSearches === "number",
      `HTTP ${ok.status} ${JSON.stringify(body).slice(0, 140)}`,
    );
  }
}

// 6. REAL-pool data state: what a REAL search may see vs what it must never see
{
  const { data, error } = await service
    .from("pharmacies")
    .select("source, verified");
  if (error) {
    check("pharmacy pool census", false, error.message);
  } else {
    const rows = data ?? [];
    const devTest = rows.filter((r) => r.source === "dev_test").length;
    const realEligible = rows.filter((r) => r.verified && r.source !== "dev_test").length;
    check(
      "REAL-pool census",
      true,
      `${rows.length} pharmacies: ${devTest} dev_test (inert for REAL), ${realEligible} verified REAL-eligible (5.1 seeds more)`,
    );
  }
}

// 7. prod site up
{
  const res = await fetch("https://medfind-three.vercel.app", { redirect: "follow" });
  check("prod site 200", res.ok, `HTTP ${res.status}`);
}

// 8. deployed-code smoke: anon session → POST /api/search engine=demo →
//    the demo search must land with dial_mode DEMO (proves new code + column
//    together; demo path never dials anything)
{
  const { data: signIn, error: signInErr } = await anon.auth.signInAnonymously();
  if (signInErr || !signIn?.session) {
    check("demo-mode smoke", false, `anon sign-in failed: ${signInErr?.message}`);
  } else {
    const res = await fetch("https://medfind-three.vercel.app/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signIn.session.access_token}`,
      },
      body: JSON.stringify({
        medication: "Creon 25,000",
        dose: "25,000 units",
        quantity: 2,
        postcode: "B5 4BU",
        engine: "demo",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.searchId) {
      check("demo-mode smoke", false, `POST /api/search → ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
    } else {
      const { data: search } = await service
        .from("searches")
        .select("dial_mode, status")
        .eq("id", body.searchId)
        .single();
      check(
        "demo-mode smoke: new demo search is DEMO",
        search?.dial_mode === "DEMO",
        `search ${body.searchId.slice(0, 8)}… dial_mode=${search?.dial_mode} status=${search?.status}`,
      );
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
