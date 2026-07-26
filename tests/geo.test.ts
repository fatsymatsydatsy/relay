import { describe, expect, it } from "vitest";
import { bearingDeg, distanceMiles, todayHoursLabel } from "@/lib/domain/geo";

describe("distanceMiles / bearingDeg", () => {
  const birmingham = { lat: 52.4776, lng: -1.8936 }; // Bullring
  const wellfield = { lat: 52.4751, lng: -1.894 };

  it("nearby points are fractions of a mile with a sane bearing", () => {
    const d = distanceMiles(birmingham, wellfield);
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.3);
    const b = bearingDeg(birmingham, wellfield);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  it("due-north bearing is ~0, due-east is ~90", () => {
    const origin = { lat: 52.0, lng: -1.0 };
    expect(bearingDeg(origin, { lat: 52.1, lng: -1.0 })).toBeCloseTo(0, 0);
    expect(bearingDeg(origin, { lat: 52.0, lng: -0.9 })).toBeCloseTo(90, 0);
  });

  it("identical points are 0 miles", () => {
    expect(distanceMiles(birmingham, birmingham)).toBe(0);
  });
});

describe("todayHoursLabel", () => {
  const allDay = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
      d,
      [["00:00", "24:00"]] as [string, string][],
    ]),
  );

  it("24/7 fixture pharmacies read 'Open 24 hours'", () => {
    expect(todayHoursLabel(allDay)).toBe("Open 24 hours");
  });

  it("renders today's sessions", () => {
    // 2026-07-26 is a Saturday UTC evening → Sunday? No: 26 Jul 2026 is a Sunday.
    const sunday = new Date("2026-07-26T10:00:00Z");
    expect(
      todayHoursLabel({ sun: [["09:00", "13:00"]] }, sunday),
    ).toBe("Today 09:00–13:00");
    expect(todayHoursLabel({ mon: [["09:00", "18:00"]] }, sunday)).toBe(
      "Closed today",
    );
  });

  it("null-safe", () => {
    expect(todayHoursLabel(null)).toBe("");
  });
});
