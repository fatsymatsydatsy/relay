import { describe, expect, it } from "vitest";
import {
  coerceArray,
  inferOwnership,
  nhsHoursToSessions,
  nhsPhone,
  normalizeNhsOrganisation,
  ukPhoneToE164,
  type NhsOpeningTime,
  type NhsOrganisation,
} from "@/lib/domain/nhs";
import { isOpenAt, staysOpenFor } from "@/lib/domain/opening-hours";

/** 5.0.1 — NHS wire data → our session format. Fail closed on everything. */

const general = (
  weekday: string,
  open: number,
  close: number,
  extra: Partial<NhsOpeningTime> = {},
): NhsOpeningTime => ({
  Weekday: weekday,
  OffsetOpeningTime: open,
  OffsetClosingTime: close,
  OpeningTimeType: "General",
  AdditionalOpeningDate: "",
  IsOpen: true,
  ...extra,
});

describe("nhsHoursToSessions", () => {
  it("weekly pattern with a lunch gap; absent Sunday = closed", () => {
    const { hours, issues } = nhsHoursToSessions([
      general("Monday", 510, 780), // 08:30–13:00
      general("Monday", 840, 1080), // 14:00–18:00
      general("Saturday", 540, 720),
    ]);
    expect(issues).toEqual([]);
    expect(hours).toEqual({
      mon: [
        ["08:30", "13:00"],
        ["14:00", "18:00"],
      ],
      sat: [["09:00", "12:00"]],
    });
    // absent day is closed to the dial rule
    const sunday = new Date("2026-07-26T10:00:00Z"); // Sunday London
    expect(isOpenAt(hours!, sunday)).toBe(false);
  });

  it("IsOpen=false rows close the day even when times are present", () => {
    const { hours } = nhsHoursToSessions([
      general("Sunday", 600, 960, { IsOpen: false }),
      general("Monday", 540, 1080),
    ]);
    expect(hours).toEqual({ mon: [["09:00", "18:00"]] });
  });

  it("prefers offsets, falls back to HH:MM strings", () => {
    const { hours } = nhsHoursToSessions([
      {
        Weekday: "Tuesday",
        OpeningTime: "09:00",
        ClosingTime: "17:30",
        OpeningTimeType: "General",
        IsOpen: true,
      },
    ]);
    expect(hours).toEqual({ tue: [["09:00", "17:30"]] });
  });

  it("date-specific Additional rows never affect the weekly pattern", () => {
    const { hours } = nhsHoursToSessions([
      general("Wednesday", 540, 1080),
      general("Wednesday", 0, 1440, {
        OpeningTimeType: "Additional",
        AdditionalOpeningDate: "Dec 25 2026",
      }),
    ]);
    expect(hours).toEqual({ wed: [["09:00", "18:00"]] });
  });

  it("a 00:00 close means end of day (24:00)", () => {
    const { hours } = nhsHoursToSessions([general("Friday", 480, 0)]);
    expect(hours).toEqual({ fri: [["08:00", "24:00"]] });
  });

  it("midnight-crossing sessions split across days (100-hour pharmacy)", () => {
    const { hours, issues } = nhsHoursToSessions([
      general("Saturday", 1200, 120), // 20:00 → 02:00 Sunday
    ]);
    expect(issues).toEqual([]);
    expect(hours).toEqual({
      sat: [["20:00", "24:00"]],
      sun: [["00:00", "02:00"]],
    });
    // and the stay-open rule sees the continuation: Sat 23:30 London has 2.5h left
    const lateSat = new Date("2026-07-25T22:30:00Z"); // 23:30 BST Saturday
    expect(staysOpenFor(hours!, 60, lateSat)).toBe(true);
  });

  it("junk kills the WHOLE object — never dial on a partial guess", () => {
    expect(
      nhsHoursToSessions([general("Monday", 540, 1080), general("Blursday", 540, 600)]).hours,
    ).toBeNull();
    expect(
      nhsHoursToSessions([
        {
          Weekday: "Monday",
          OpeningTime: "9am",
          ClosingTime: "late",
          OpeningTimeType: "General",
          IsOpen: true,
        },
      ]).hours,
    ).toBeNull();
  });

  it("accepts the JSON-encoded-string wire variant", () => {
    const { hours } = nhsHoursToSessions(JSON.stringify([general("Monday", 540, 1080)]));
    expect(hours).toEqual({ mon: [["09:00", "18:00"]] });
    expect(coerceArray("not json")).toEqual([]);
  });
});

describe("phones", () => {
  it("national formats normalize to E.164", () => {
    expect(ukPhoneToE164("01243552566")).toBe("+441243552566");
    expect(ukPhoneToE164("0121 622 1234")).toBe("+441216221234");
    expect(ukPhoneToE164("(0121) 622-1234")).toBe("+441216221234");
    expect(ukPhoneToE164("+44 121 622 1234")).toBe("+441216221234");
    expect(ukPhoneToE164("00441216221234")).toBe("+441216221234");
  });

  it("refuses to guess", () => {
    expect(ukPhoneToE164("1234")).toBeNull(); // no trunk prefix
    expect(ukPhoneToE164("")).toBeNull();
    expect(ukPhoneToE164("call the shop")).toBeNull();
  });

  it("picks the Primary telephone contact", () => {
    expect(
      nhsPhone([
        { ContactType: "Additional", ContactMethodType: "Telephone", ContactValue: "0121 111 1111" },
        { ContactType: "Primary", ContactMethodType: "Website", ContactValue: "https://x" },
        { ContactType: "Primary", ContactMethodType: "Telephone", ContactValue: "0121 222 2222" },
      ]),
    ).toBe("+441212222222");
    expect(nhsPhone([{ ContactMethodType: "Email", ContactValue: "a@b.c" }])).toBeNull();
  });
});

describe("ownership inference", () => {
  it("chains and supermarkets feed the portfolio constraints", () => {
    expect(inferOwnership("Boots")).toEqual({ ownershipGroup: "boots", isSupermarket: false });
    expect(inferOwnership("Asda Pharmacy Small Heath")).toEqual({
      ownershipGroup: "asda",
      isSupermarket: true,
    });
    expect(inferOwnership("Jhoots Pharmacy")).toEqual({
      ownershipGroup: "jhoots",
      isSupermarket: false,
    });
    expect(inferOwnership("Digbeth Village Pharmacy")).toEqual({
      ownershipGroup: "independent",
      isSupermarket: false,
    });
    // "Wellington Pharmacy" must NOT match the Well chain
    expect(inferOwnership("Wellington Pharmacy")).toEqual({
      ownershipGroup: "independent",
      isSupermarket: false,
    });
  });
});

describe("normalizeNhsOrganisation", () => {
  const org = (overrides: Partial<NhsOrganisation> = {}): NhsOrganisation => ({
    ODSCode: "FA512",
    OrganisationName: "Digbeth Village Pharmacy",
    OrganisationTypeId: "PHA",
    OrganisationSubType: "Community",
    Address1: "12 Digbeth High Street",
    City: "Birmingham",
    Postcode: "B5 6DY",
    Latitude: 52.4751,
    Longitude: -1.8904,
    OpeningTimes: [general("Sunday", 600, 960)],
    Contacts: [
      { ContactType: "Primary", ContactMethodType: "Telephone", ContactValue: "0121 622 1234" },
    ],
    ...overrides,
  });

  it("maps a clean community pharmacy", () => {
    const { row, issues } = normalizeNhsOrganisation(org());
    expect(issues).toEqual([]);
    expect(row).toMatchObject({
      ods_code: "FA512",
      phone: "+441216221234",
      postcode: "B5 6DY",
      source: "nhs_api",
      verified: false,
      hours: { sun: [["10:00", "16:00"]] },
      ownership_group: "independent",
    });
    expect(row!.address).toContain("Digbeth High Street");
  });

  it("drops non-community and non-pharmacy organisations", () => {
    expect(normalizeNhsOrganisation(org({ OrganisationSubType: "DSP" })).row).toBeNull();
    expect(normalizeNhsOrganisation(org({ OrganisationTypeId: "DEN" })).row).toBeNull();
  });

  it("drops rows without a dialable phone or coordinates", () => {
    expect(normalizeNhsOrganisation(org({ Contacts: [] })).row).toBeNull();
    expect(normalizeNhsOrganisation(org({ Latitude: null, Longitude: null })).row).toBeNull();
  });

  it("unusable hours seed as never-open, with the issue reported", () => {
    const { row, issues } = normalizeNhsOrganisation(
      org({ OpeningTimes: [{ Weekday: "Funday", OpeningTime: "09:00", ClosingTime: "17:00", OpeningTimeType: "General", IsOpen: true }] }),
    );
    expect(row).not.toBeNull();
    expect(row!.hours).toEqual({});
    expect(isOpenAt(row!.hours, new Date())).toBe(false); // fail closed forever
    expect(issues.join(" ")).toContain("fail closed");
  });
});
