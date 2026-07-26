/**
 * Opening hours — pure logic, no I/O (2.1).
 *
 * Hours format (established by the seed + fixtures, stored in
 * pharmacies.hours jsonb): per-day session lists on Europe/London WALL CLOCK:
 *   { "mon": [["09:00","13:00"], ["14:00","18:00"]], ... "sun": [] }
 * Sessions never cross midnight (split across days); "24:00" is a valid end.
 * 24/7 = ["00:00","24:00"] every day.
 *
 * Every decision here is in Europe/London regardless of server timezone —
 * the BST boundary is a money rule (voicemail pickup on a closed pharmacy is
 * billed): tests/opening-hours.test.ts `hours.bst-boundary`.
 */

export type DaySessions = [string, string][];
export type OpeningHours = Partial<Record<DayKey, DaySessions>>;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const TIME_RE = /^([01][0-9]|2[0-4]):([0-5][0-9])$/;

/** "18:30" → minutes since midnight (1110). "24:00" → 1440. Null if invalid. */
export function parseTime(time: string): number | null {
  const m = TIME_RE.exec(time);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 ? minutes : null;
}

/** Validates a whole hours object; returns a reason string or null when ok.
 *  seed_pharmacies uses this at ingest so bad data never reaches dialing. */
export function validateHours(hours: unknown): string | null {
  if (typeof hours !== "object" || hours === null || Array.isArray(hours)) {
    return "hours must be an object of day keys";
  }
  for (const [day, sessions] of Object.entries(hours)) {
    if (!(DAY_KEYS as readonly string[]).includes(day)) return `unknown day key "${day}"`;
    if (!Array.isArray(sessions)) return `${day}: sessions must be an array`;
    for (const s of sessions) {
      if (!Array.isArray(s) || s.length !== 2) return `${day}: each session is [open, close]`;
      const open = parseTime(s[0]);
      const close = parseTime(s[1]);
      if (open === null || close === null) return `${day}: bad time in [${s[0]}, ${s[1]}]`;
      if (open >= close) return `${day}: open must be before close ([${s[0]}, ${s[1]}])`;
    }
  }
  return null;
}

interface LondonClock {
  day: DayKey;
  minutes: number; // minutes since London midnight
}

const LONDON_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A UTC instant → London wall-clock day + minutes (DST-correct). */
export function londonClock(at: Date): LondonClock {
  const parts = LONDON_FMT.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as DayKey;
  // Intl may render midnight as "24" with hour12:false on some ICU versions.
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

function sessionsFor(hours: OpeningHours, day: DayKey): DaySessions {
  return hours[day] ?? [];
}

function nextDay(day: DayKey): DayKey {
  return DAY_KEYS[(DAY_KEYS.indexOf(day) + 1) % 7];
}

/** Open at this instant? Closed on parse-invalid data — never dial on junk. */
export function isOpenAt(hours: OpeningHours, at: Date): boolean {
  if (validateHours(hours) !== null) return false;
  const { day, minutes } = londonClock(at);
  return sessionsFor(hours, day).some(([open, close]) => {
    const o = parseTime(open)!;
    const c = parseTime(close)!;
    return minutes >= o && minutes < c;
  });
}

/**
 * Open now AND still open in `forMinutes`? The throw-out rule: never dial a
 * pharmacy that closes within the hour. A session ending at 24:00 continues
 * into a next-day session starting at 00:00 (24/7 pharmacies never fail this).
 */
export function staysOpenFor(
  hours: OpeningHours,
  forMinutes: number,
  at: Date,
): boolean {
  if (validateHours(hours) !== null) return false;
  const { day, minutes } = londonClock(at);

  const current = sessionsFor(hours, day).find(([open, close]) => {
    const o = parseTime(open)!;
    const c = parseTime(close)!;
    return minutes >= o && minutes < c;
  });
  if (!current) return false;

  let remaining = parseTime(current[1])! - minutes;
  if (parseTime(current[1])! === 1440) {
    // rolls over midnight if tomorrow opens at 00:00
    const tomorrow = sessionsFor(hours, nextDay(day));
    const continuation = tomorrow.find(([open]) => parseTime(open) === 0);
    if (continuation) remaining += parseTime(continuation[1])!;
  }
  return remaining >= forMinutes;
}

/** Total open minutes per week — the portfolio scorer's size proxy (2.2). */
export function weeklyOpenMinutes(hours: OpeningHours): number {
  if (validateHours(hours) !== null) return 0;
  let total = 0;
  for (const day of DAY_KEYS) {
    for (const [open, close] of sessionsFor(hours, day)) {
      total += parseTime(close)! - parseTime(open)!;
    }
  }
  return total;
}

/**
 * The next London instant this pharmacy opens, within `lookaheadDays` — the
 * zero-open-pharmacies path shows "opens at HH:MM" instead of dialing nobody.
 * Returns null if never (empty hours).
 */
export function nextOpening(
  hours: OpeningHours,
  at: Date,
  lookaheadDays = 8,
): { day: DayKey; time: string } | null {
  if (validateHours(hours) !== null) return null;
  const start = londonClock(at);
  let day = start.day;
  for (let i = 0; i < lookaheadDays; i++) {
    const floor = i === 0 ? start.minutes : -1;
    const upcoming = sessionsFor(hours, day)
      .map(([open]) => parseTime(open)!)
      .filter((o) => o > floor)
      .sort((a, b) => a - b)[0];
    if (upcoming !== undefined) {
      const h = String(Math.floor(upcoming / 60)).padStart(2, "0");
      const m = String(upcoming % 60).padStart(2, "0");
      return { day, time: `${h}:${m}` };
    }
    day = nextDay(day);
  }
  return null;
}
