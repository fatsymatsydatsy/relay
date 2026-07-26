/** Pure geo math for the schematic map: patient position → pharmacy pins. */

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles, rounded to one decimal. */
export function distanceMiles(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const d = 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(s));
  return Math.round(d * 10) / 10;
}

/** Initial compass bearing from a to b, degrees 0–360 (0 = north). */
export function bearingDeg(a: Point, b: Point): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Human label for today's opening hours from the per-day sessions jsonb
 * ({"mon": [["09:00","18:00"]], ...}). Not the 2.1 opening-hours module —
 * display only, no open/closed decisions here.
 */
export function todayHoursLabel(
  hours: Record<string, [string, string][]> | null | undefined,
  now: Date = new Date(),
): string {
  if (!hours) return "";
  const key = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  })
    .format(now)
    .toLowerCase()
    .slice(0, 3); // "mon" … "sun"
  const sessions = hours[key];
  if (!sessions || sessions.length === 0) return "Closed today";
  if (sessions.some(([open, close]) => open === "00:00" && close === "24:00")) {
    return "Open 24 hours";
  }
  return `Today ${sessions.map(([open, close]) => `${open}–${close}`).join(", ")}`;
}
