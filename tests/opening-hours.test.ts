import { describe, expect, it } from "vitest";
import {
  isOpenAt,
  londonClock,
  nextOpening,
  parseTime,
  staysOpenFor,
  validateHours,
  weeklyOpenMinutes,
  type OpeningHours,
} from "@/lib/domain/opening-hours";

const NINE_TO_SIX: OpeningHours = {
  mon: [["09:00", "18:00"]],
  tue: [["09:00", "18:00"]],
  wed: [["09:00", "18:00"]],
  thu: [["09:00", "18:00"]],
  fri: [["09:00", "18:00"]],
  sat: [["09:00", "18:00"]],
};

const ALL_DAY: OpeningHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
    d,
    [["00:00", "24:00"]],
  ]),
);

describe("hours.bst-boundary — 18:30 London is NOT 17:30 UTC in July", () => {
  // Sat 25 Jul 2026 17:30 UTC = 18:30 in London (BST, UTC+1).
  // A pharmacy closing at 18:00 London is CLOSED — naive-UTC math says open.
  it("BST: 17:30 UTC in July reads as 18:30 London → closed", () => {
    const at = new Date("2026-07-25T17:30:00Z");
    expect(londonClock(at)).toEqual({ day: "sat", minutes: 18 * 60 + 30 });
    expect(isOpenAt(NINE_TO_SIX, at)).toBe(false);
  });

  it("GMT: 17:30 UTC in January reads as 17:30 London → open", () => {
    const at = new Date("2026-01-24T17:30:00Z"); // Saturday, winter
    expect(londonClock(at)).toEqual({ day: "sat", minutes: 17 * 60 + 30 });
    expect(isOpenAt(NINE_TO_SIX, at)).toBe(true);
    // …but closing at 18:00, it does NOT stay open for the 1h throw-out rule
    expect(staysOpenFor(NINE_TO_SIX, 60, at)).toBe(false);
    expect(staysOpenFor(NINE_TO_SIX, 30, at)).toBe(true);
  });
});

describe("lunch closure", () => {
  const LUNCH: OpeningHours = { mon: [["09:00", "13:00"], ["14:00", "18:00"]] };
  // Mon 26 Jan 2026, GMT — wall clock == UTC
  it("closed mid-lunch, open either side", () => {
    expect(isOpenAt(LUNCH, new Date("2026-01-26T13:30:00Z"))).toBe(false);
    expect(isOpenAt(LUNCH, new Date("2026-01-26T12:30:00Z"))).toBe(true);
    expect(isOpenAt(LUNCH, new Date("2026-01-26T14:30:00Z"))).toBe(true);
  });

  it("staysOpenFor never spans the lunch gap", () => {
    // 12:30 + 60min crosses the 13:00 close → false
    expect(staysOpenFor(LUNCH, 60, new Date("2026-01-26T12:30:00Z"))).toBe(false);
  });
});

describe("midnight & 24/7", () => {
  it("24/7 fake pharmacy is open at 23:30 and stays open across midnight", () => {
    const at = new Date("2026-07-25T22:30:00Z"); // 23:30 London BST
    expect(isOpenAt(ALL_DAY, at)).toBe(true);
    expect(staysOpenFor(ALL_DAY, 60, at)).toBe(true); // rolls into next day
  });

  it("a 24:00 close without a next-day continuation ends at midnight", () => {
    const LATE: OpeningHours = { sat: [["20:00", "24:00"]], sun: [["10:00", "16:00"]] };
    const at = new Date("2026-07-25T22:30:00Z"); // Sat 23:30 London
    expect(isOpenAt(LATE, at)).toBe(true);
    expect(staysOpenFor(LATE, 60, at)).toBe(false); // sun opens 10:00, not 00:00
  });

  it("exactly at close is closed (half-open interval)", () => {
    expect(isOpenAt(NINE_TO_SIX, new Date("2026-01-26T18:00:00Z"))).toBe(false);
  });
});

describe("validation — junk data never dials", () => {
  it("rejects malformed shapes and bad times", () => {
    expect(validateHours(null)).not.toBeNull();
    expect(validateHours({ funday: [["09:00", "18:00"]] })).not.toBeNull();
    expect(validateHours({ mon: [["9am", "6pm"]] })).not.toBeNull();
    expect(validateHours({ mon: [["18:00", "09:00"]] })).not.toBeNull();
    expect(validateHours({ mon: [["09:00", "25:00"]] })).not.toBeNull();
    expect(validateHours(NINE_TO_SIX)).toBeNull();
    expect(validateHours({})).toBeNull(); // closed everywhere is valid data
  });

  it("isOpenAt/staysOpenFor are false on invalid hours", () => {
    const bad = { mon: [["9am", "6pm"]] } as unknown as OpeningHours;
    expect(isOpenAt(bad, new Date())).toBe(false);
    expect(staysOpenFor(bad, 60, new Date())).toBe(false);
  });

  it("parseTime accepts 24:00 and rejects 24:01", () => {
    expect(parseTime("24:00")).toBe(1440);
    expect(parseTime("24:01")).toBeNull();
  });
});

describe("weeklyOpenMinutes (scorer size proxy) & nextOpening", () => {
  it("sums sessions across the week", () => {
    expect(weeklyOpenMinutes(NINE_TO_SIX)).toBe(6 * 9 * 60);
    expect(weeklyOpenMinutes(ALL_DAY)).toBe(7 * 1440);
    expect(weeklyOpenMinutes({})).toBe(0);
  });

  it("finds the next opening across days", () => {
    // Sat 19:00 London → next opening Mon 09:00 (nothing Sunday)
    const at = new Date("2026-01-24T19:00:00Z");
    expect(nextOpening(NINE_TO_SIX, at)).toEqual({ day: "mon", time: "09:00" });
    expect(nextOpening({}, at)).toBeNull();
  });
});
