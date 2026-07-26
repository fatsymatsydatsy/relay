import { describe, expect, it } from "vitest";
import { sanitizeProps } from "@/lib/analytics";

// Health-search data must never reach analytics (PRODUCT.md privacy rule;
// 26 Jul review P1-2): capture() strips everything not on the allowlist.

describe("analytics property allowlist", () => {
  it("strips medication, dose, postcode, email and unknown keys", () => {
    expect(
      sanitizeProps({
        medication: "Creon 25,000",
        dose: "25,000",
        postcode: "B5 4BU",
        email: "someone@example.com",
        anything_else: "value",
      }),
    ).toBeUndefined();
  });

  it("keeps only allowlisted keys when mixed", () => {
    expect(
      sanitizeProps({ variant: "hero", medication: "Creon" }),
    ).toEqual({ variant: "hero" });
  });

  it("passes through undefined", () => {
    expect(sanitizeProps(undefined)).toBeUndefined();
  });
});
