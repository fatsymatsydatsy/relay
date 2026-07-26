import { describe, expect, it } from "vitest";
import { isAuthorizedInternal } from "@/lib/domain/internal-auth";

/** 4.2/4.4 internal.secret-guard — fail closed in every misconfiguration. */
describe("internal.secret-guard", () => {
  const SECRET = "a-long-internal-secret-value";

  it("matching secret authorizes", () => {
    expect(isAuthorizedInternal(SECRET, SECRET)).toBe(true);
  });

  it("wrong, missing, or empty header → 401", () => {
    expect(isAuthorizedInternal("nope", SECRET)).toBe(false);
    expect(isAuthorizedInternal(null, SECRET)).toBe(false);
    expect(isAuthorizedInternal("", SECRET)).toBe(false);
  });

  it("unset or weak SERVER secret fails closed — a bad deploy never opens the route", () => {
    expect(isAuthorizedInternal("anything", undefined)).toBe(false);
    expect(isAuthorizedInternal("anything", "")).toBe(false);
    expect(isAuthorizedInternal("short", "short")).toBe(false); // < 16 chars
  });
});
