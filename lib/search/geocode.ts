export interface LatLng {
  lat: number;
  lng: number;
}

/** UK postcode shape (outward + inward), space optional on input. */
const POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

/**
 * Uppercases, strips spaces, validates, and returns the canonical spaced form
 * ("b54bu" → "B5 4BU"), or null when the input is not a plausible UK postcode.
 * Pure — unit-tested in tests/postcode.test.ts. Every postcode entering the
 * app goes through this before it is used anywhere (codex P1-4/P2-1).
 */
export function normalizePostcode(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (compact.length < 5 || compact.length > 7) return null;
  if (!POSTCODE_RE.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/**
 * Resolves a UK postcode to coordinates via OUR /api/geocode proxy (the
 * browser never contacts postcodes.io directly — P1-3). Returns null on any
 * failure: callers must show an explicit "couldn't place this postcode" state,
 * never silently substitute a default city (P2-1).
 */
export async function geocodePostcode(postcode: string): Promise<LatLng | null> {
  const normalized = normalizePostcode(postcode);
  if (!normalized) return null;

  try {
    const res = await fetch(
      `/api/geocode?postcode=${encodeURIComponent(normalized)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<LatLng>;
    if (typeof data.lat !== "number" || typeof data.lng !== "number") {
      return null;
    }
    return { lat: data.lat, lng: data.lng };
  } catch {
    return null;
  }
}

// (The tile-map helpers escapeHtml/offsetLatLng left with the Leaflet map —
// the schematic PharmacyMap positions pins itself and React escapes text.
// geocodePostcode stays: the 1.5 live engine derives distance/bearing from
// the patient's geocoded position + pharmacy lat/lng.)
