// 5.2.2 — manual tick loop while pg_cron is down.
//
//   node scripts/tick-loop.mjs [--interval 30] [--for 30] [--once] [--url https://…]
//
// POSTs the watchdog route with INTERNAL_SECRET every `--interval` seconds
// (default 30) for `--for` minutes (default 30), printing one line per tick.
// This is the same call pg_cron would make (scripts/setup-watchdog.sql); the
// route is idempotent, so overlapping with a recovered cron is harmless.
import { readFileSync } from "node:fs";

const argv = process.argv;
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!env.INTERNAL_SECRET) throw new Error("INTERNAL_SECRET missing from .env.local");

const url = `${arg("url", "https://medfind-three.vercel.app")}/api/internal/watchdog`;
const intervalS = Number(arg("interval", "30"));
const maxTicks = argv.includes("--once") ? 1 : Math.ceil((Number(arg("for", "30")) * 60) / intervalS);

const stamp = () => new Date().toISOString().slice(11, 19);
for (let i = 0; i < maxTicks; i++) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-internal-secret": env.INTERNAL_SECRET },
    });
    const body = await res.text();
    console.log(`${stamp()} tick ${i + 1}/${maxTicks} HTTP ${res.status} ${body.slice(0, 200)}`);
  } catch (err) {
    console.log(`${stamp()} tick ${i + 1}/${maxTicks} FAILED ${String(err).slice(0, 120)}`);
  }
  if (i < maxTicks - 1) await new Promise((r) => setTimeout(r, intervalS * 1000));
}
