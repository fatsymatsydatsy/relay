import { validateHours, type DayKey, type OpeningHours } from "./opening-hours";

/**
 * NHS Directory of Healthcare Services (v3) → our domain shapes (5.0).
 *
 * Pure logic, no I/O. Everything here is FAIL-CLOSED: a pharmacy whose NHS
 * data can't be normalized cleanly gets `hours: null` (the seeder stores `{}`
 * — a shape that validates but is never open, so the claim can never dial it)
 * or is excluded entirely (no phone / no ODS / no geo). API data is never
 * dial-truth on its own: rows land `verified: false` and only the runbook's
 * human spot-call flips them.
 *
 * Wire facts (OAS 474338 + sandbox probe, 26 Jul 2026):
 * - `OpeningTimes[]`: `Weekday` "Monday"…"Sunday", minutes-past-midnight
 *   `OffsetOpeningTime`/`OffsetClosingTime` (also "HH:MM" strings),
 *   `OpeningTimeType` "General" | "Additional", `AdditionalOpeningDate`,
 *   `IsOpen` boolean. May arrive as a JSON-encoded STRING instead of an array.
 * - `Contacts[]`: `ContactMethodType` "Telephone" etc., `ContactValue` in
 *   national format ("01243552566"). Same string-encoding caveat.
 */

export interface NhsOpeningTime {
  Weekday?: string;
  OpeningTime?: string;
  ClosingTime?: string;
  OffsetOpeningTime?: number;
  OffsetClosingTime?: number;
  OpeningTimeType?: string;
  AdditionalOpeningDate?: string;
  IsOpen?: boolean;
}

export interface NhsContact {
  ContactType?: string;
  ContactMethodType?: string;
  ContactValue?: string;
}

export interface NhsOrganisation {
  ODSCode?: string | null;
  OrganisationName?: string | null;
  OrganisationTypeId?: string | null;
  OrganisationSubType?: string | null;
  OrganisationStatus?: string | null;
  Address1?: string | null;
  Address2?: string | null;
  Address3?: string | null;
  City?: string | null;
  County?: string | null;
  Postcode?: string | null;
  Latitude?: number | string | null;
  Longitude?: number | string | null;
  OpeningTimes?: NhsOpeningTime[] | string | null;
  Contacts?: NhsContact[] | string | null;
}

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
};
const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Arrays sometimes arrive JSON-encoded as strings — accept both, else []. */
export function coerceArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function minutesFrom(offset: number | undefined, hhmm: string | undefined): number | null {
  if (typeof offset === "number" && Number.isInteger(offset) && offset >= 0 && offset <= 1440) {
    return offset;
  }
  if (typeof hhmm === "string") {
    const m = /^([0-9]{2}):([0-9]{2})$/.exec(hhmm.trim());
    if (m) {
      const minutes = Number(m[1]) * 60 + Number(m[2]);
      if (Number(m[2]) <= 59 && minutes <= 1440) return minutes;
    }
  }
  return null;
}

function fmt(minutes: number): string {
  if (minutes === 1440) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * General weekly `OpeningTimes` → our per-day session format. Date-specific
 * "Additional" rows are ignored (bank-holiday overrides are the spot-call's
 * job today). Midnight-crossing sessions split across days per our
 * convention. Returns `hours: null` when ANYTHING fails to normalize —
 * the caller must then store a never-opens shape, not guess.
 */
export function nhsHoursToSessions(
  openingTimes: NhsOpeningTime[] | string | null | undefined,
): { hours: OpeningHours | null; issues: string[] } {
  const issues: string[] = [];
  const rows = coerceArray<NhsOpeningTime>(openingTimes);
  const byDay = new Map<DayKey, [number, number][]>();

  for (const row of rows) {
    const type = (row.OpeningTimeType ?? "General").trim().toLowerCase();
    if (type !== "general") continue; // date-specific rows are not the weekly pattern
    if ((row.AdditionalOpeningDate ?? "").trim() !== "") continue;

    const day = WEEKDAY_TO_KEY[(row.Weekday ?? "").trim().toLowerCase()];
    if (!day) {
      issues.push(`unknown weekday "${row.Weekday}"`);
      return { hours: null, issues };
    }
    if (row.IsOpen === false) {
      if (!byDay.has(day)) byDay.set(day, []);
      continue; // explicitly closed that day
    }

    const open = minutesFrom(row.OffsetOpeningTime, row.OpeningTime);
    let close = minutesFrom(row.OffsetClosingTime, row.ClosingTime);
    if (open === null || close === null) {
      issues.push(`${day}: unreadable times (${row.OpeningTime}–${row.ClosingTime})`);
      return { hours: null, issues };
    }
    if (close === 0 && open > 0) close = 1440; // "…–00:00" means end of day
    if (open === close) continue; // zero-length session — ignore

    const sessions = byDay.get(day) ?? [];
    if (open < close) {
      sessions.push([open, close]);
      byDay.set(day, sessions);
    } else {
      // crosses midnight: split per our convention (sessions never cross)
      sessions.push([open, 1440]);
      byDay.set(day, sessions);
      const next = DAY_ORDER[(DAY_ORDER.indexOf(day) + 1) % 7];
      const nextSessions = byDay.get(next) ?? [];
      nextSessions.push([0, close]);
      byDay.set(next, nextSessions);
    }
  }

  const hours: OpeningHours = {};
  for (const day of DAY_ORDER) {
    const sessions = byDay.get(day);
    if (!sessions || sessions.length === 0) continue; // absent = closed
    sessions.sort((a, b) => a[0] - b[0]);
    hours[day] = sessions.map(([o, c]) => [fmt(o), fmt(c)] as [string, string]);
  }

  const invalid = validateHours(hours);
  if (invalid) {
    issues.push(`normalized hours failed validation: ${invalid}`);
    return { hours: null, issues };
  }
  return { hours, issues };
}

/** Primary telephone from Contacts, normalized to E.164 (+44…), else null. */
export function nhsPhone(
  contacts: NhsContact[] | string | null | undefined,
): string | null {
  const rows = coerceArray<NhsContact>(contacts).filter(
    (c) => (c.ContactMethodType ?? "").trim().toLowerCase() === "telephone",
  );
  rows.sort((a, b) => {
    const primary = (c: NhsContact) =>
      (c.ContactType ?? "").trim().toLowerCase() === "primary" ? 0 : 1;
    return primary(a) - primary(b);
  });
  for (const row of rows) {
    const normalized = ukPhoneToE164(row.ContactValue ?? "");
    if (normalized) return normalized;
  }
  return null;
}

export function ukPhoneToE164(raw: string): string | null {
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = `+${digits.slice(1).replace(/\D/g, "")}`;
  } else if (digits.startsWith("00")) {
    digits = `+${digits.slice(2)}`;
  } else if (digits.startsWith("0")) {
    digits = `+44${digits.slice(1)}`;
  } else if (digits.startsWith("44")) {
    digits = `+${digits}`;
  } else if (digits.length > 0) {
    return null; // no trunk prefix and not international — refuse to guess
  }
  return /^\+[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}

const CHAINS: [pattern: RegExp, group: string, supermarket: boolean][] = [
  [/\bboots\b/, "boots", false],
  [/\blloyds\s?pharmacy\b/, "lloydspharmacy", false],
  [/\bwell\b(?!ington|s\b)/, "well", false],
  [/\browlands\b/, "rowlands", false],
  [/\bsuperdrug\b/, "superdrug", false],
  [/\bday\s?lewis\b/, "daylewis", false],
  [/\bjhoots\b/, "jhoots", false],
  [/\bkamsons\b/, "kamsons", false],
  [/\bcohens\b/, "cohens", false],
  [/\bpaydens\b/, "paydens", false],
  [/\basda\b/, "asda", true],
  [/\btesco\b/, "tesco", true],
  [/\bsainsbury'?s?\b/, "sainsburys", true],
  [/\bmorrisons\b/, "morrisons", true],
  [/\bsuperdrug\s+health/, "superdrug", false],
];

/** Chain + supermarket inference from the organisation name — feeds the
 *  portfolio's ≤2-per-chain cap and supermarket quota. Unknown → independent. */
export function inferOwnership(name: string): {
  ownershipGroup: string;
  isSupermarket: boolean;
} {
  const lower = name.toLowerCase();
  for (const [pattern, group, supermarket] of CHAINS) {
    if (pattern.test(lower)) return { ownershipGroup: group, isSupermarket: supermarket };
  }
  return { ownershipGroup: "independent", isSupermarket: false };
}

export interface NormalizedPharmacy {
  ods_code: string;
  name: string;
  address: string;
  postcode: string;
  phone: string;
  lat: number;
  lng: number;
  hours: OpeningHours;
  ownership_group: string;
  is_supermarket: boolean;
  verified: false;
  number_type: "geographic";
  source: "nhs_api";
}

export interface NormalizationOutcome {
  row: NormalizedPharmacy | null;
  /** why the row was dropped, or non-fatal warnings (e.g. hours zeroed) */
  issues: string[];
}

/** One NHS organisation → one pharmacies row (or null + reasons). Hours that
 *  fail normalization become `{}` — the row exists but can never dial. */
export function normalizeNhsOrganisation(org: NhsOrganisation): NormalizationOutcome {
  const issues: string[] = [];
  const ods = (org.ODSCode ?? "").trim();
  const name = (org.OrganisationName ?? "").trim();
  if (!ods || !name) return { row: null, issues: ["missing ODSCode or name"] };

  if ((org.OrganisationTypeId ?? "").trim().toUpperCase() !== "PHA") {
    return { row: null, issues: [`not a pharmacy (type ${org.OrganisationTypeId})`] };
  }
  const subType = (org.OrganisationSubType ?? "").trim().toLowerCase();
  if (subType && subType !== "community") {
    // DSP/internet pharmacies can't serve a walk-in patient
    return { row: null, issues: [`non-community pharmacy (${org.OrganisationSubType})`] };
  }

  const phone = nhsPhone(org.Contacts);
  if (!phone) return { row: null, issues: ["no usable telephone contact"] };

  const lat = Number(org.Latitude);
  const lng = Number(org.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return { row: null, issues: ["missing coordinates"] };
  }

  const postcode = (org.Postcode ?? "").trim();
  if (!postcode) return { row: null, issues: ["missing postcode"] };

  const address = [org.Address1, org.Address2, org.Address3, org.City]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");

  const { hours, issues: hourIssues } = nhsHoursToSessions(org.OpeningTimes);
  if (!hours) {
    issues.push(...hourIssues, "hours unusable — seeded as never-open (fail closed)");
  }

  const { ownershipGroup, isSupermarket } = inferOwnership(name);
  return {
    row: {
      ods_code: ods,
      name,
      address: address || postcode,
      postcode,
      phone,
      lat,
      lng,
      hours: hours ?? {},
      ownership_group: ownershipGroup,
      is_supermarket: isSupermarket,
      verified: false,
      number_type: "geographic",
      source: "nhs_api",
    },
    issues,
  };
}
