import { describe, expect, it } from "vitest";
import { shouldScheduleInterpretation } from "@/lib/domain/webhook-policy";

/**
 * webhook.duplicate-interprets (3.7, audit P1-7 minimal fix).
 *
 * The route schedules recordCallEvent per this policy; interpretation itself
 * is idempotent (webhook.idempotent in record-call-event.int.test.ts proves a
 * replay is one transition, one extract, one dispatch) — so re-interpreting a
 * duplicate delivery is safe, and it is the ONLY thing that can heal a lost
 * post-200 after(): the provider redelivers, the raw insert hits the unique
 * dedupe index (23505), and the transition still lands.
 */
describe("webhook.duplicate-interprets — scheduling policy", () => {
  it("first delivery (no insert error) interprets", () => {
    expect(shouldScheduleInterpretation(null)).toBe(true);
  });

  it("a duplicate redelivery (23505) STILL interprets — heals a lost after()", () => {
    expect(shouldScheduleInterpretation({ code: "23505" })).toBe(true);
  });

  it("raw-not-persisted errors do NOT interpret (store-raw-first is the evidence rule)", () => {
    expect(shouldScheduleInterpretation({ code: "42P01" })).toBe(false);
    expect(shouldScheduleInterpretation({ code: "XX000" })).toBe(false);
    expect(shouldScheduleInterpretation({ code: undefined })).toBe(false);
  });
});
