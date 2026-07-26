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
 * Escapes text for interpolation into HTML strings (Leaflet DivIcons assign
 * markup via innerHTML — user text must never pass through unescaped, codex
 * P1-4). Pure — unit-tested.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

const MILES_PER_DEG_LAT = 69.0;

/**
 * Projects a pharmacy's simulated bearing + distance from the patient's real
 * coordinates onto real lat/lng, so pins land in believable places around the
 * searched postcode.
 */
export function offsetLatLng(
  origin: LatLng,
  distanceMiles: number,
  bearingDeg: number,
): LatLng {
  const rad = (bearingDeg * Math.PI) / 180;
  const dNorth = distanceMiles * Math.cos(rad);
  const dEast = distanceMiles * Math.sin(rad);
  return {
    lat: origin.lat + dNorth / MILES_PER_DEG_LAT,
    lng:
      origin.lng +
      dEast / (MILES_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)),
  };
}
