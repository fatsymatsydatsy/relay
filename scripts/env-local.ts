import { readFileSync } from "node:fs";

/** Shared by the run-by-hand tsx scripts: read .env.local (gitignored)
 *  without touching process.env. Values are never printed. */
export function loadEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}
