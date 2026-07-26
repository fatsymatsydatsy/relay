/**
 * 5.2c — which engine does /search run? (designed-out bug: engine.default-live)
 *
 * The deployed default page must BE the product: no param, a junk param, or
 * anything unrecognized all resolve to the LIVE pipeline. Fake data is an
 * explicit opt-in only: `?engine=sim` (client-side simulation, marketing/
 * backup) or `?engine=demo` (DB fixture board, no dialing ever).
 */
export type EngineKind = "live" | "demo" | "simulated";

export function resolveEngineKind(param: string | null): EngineKind {
  if (param === "sim") return "simulated";
  if (param === "demo") return "demo";
  return "live";
}
