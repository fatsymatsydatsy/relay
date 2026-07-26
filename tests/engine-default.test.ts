import { describe, expect, it } from "vitest";
import { resolveEngineKind } from "@/lib/search/engine-select";

/**
 * 5.2c — designed-out bug `engine.default-live`: the deployed default page
 * must be the REAL product. Marvin hit the client-side simulation on plain
 * /search during 5.2 manual testing (and earlier during the 4.3 RLS test) —
 * fake data must now require an explicit opt-in, never be a landing state.
 */
describe("resolveEngineKind", () => {
  it("no param → LIVE (the product, not the demo)", () => {
    expect(resolveEngineKind(null)).toBe("live");
  });

  it("explicit opt-ins still work", () => {
    expect(resolveEngineKind("sim")).toBe("simulated");
    expect(resolveEngineKind("demo")).toBe("demo");
    expect(resolveEngineKind("live")).toBe("live");
  });

  it("junk and unknown params fall to LIVE, never to fake data", () => {
    expect(resolveEngineKind("")).toBe("live");
    expect(resolveEngineKind("simulated")).toBe("live"); // exact tokens only
    expect(resolveEngineKind("DEMO")).toBe("live");
    expect(resolveEngineKind("banana")).toBe("live");
  });
});
