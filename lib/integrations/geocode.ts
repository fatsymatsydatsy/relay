import { normalizePostcode } from "@/lib/search/geocode";

/**
 * Server-side postcode → coordinates via postcodes.io (free, no key; Marvin
 * signed off the service under F4 with the proxy pattern — the BROWSER never
 * calls it, only our server does). Used by the /api/geocode proxy and by
 * create_search. Full-postcode lookup, then outward-code fallback, then null.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type Geocoder = (postcode: string) => Promise<GeoPoint | null>;

export const geocodePostcodeServer: Geocoder = async (postcode) => {
  const normalized = normalizePostcode(postcode);
  if (!normalized) return null;

  const full = await lookup(`postcodes/${encodeURIComponent(normalized)}`);
  if (full) return full;

  const outward = normalized.split(" ")[0];
  return lookup(`outcodes/${encodeURIComponent(outward)}`);
};

interface PostcodesIoResponse {
  result?: { latitude?: number; longitude?: number };
}

async function lookup(path: string): Promise<GeoPoint | null> {
  try {
    const res = await fetch(`https://api.postcodes.io/${path}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PostcodesIoResponse;
    const r = data.result;
    if (!r || typeof r.latitude !== "number" || typeof r.longitude !== "number") {
      return null;
    }
    return { lat: r.latitude, lng: r.longitude };
  } catch {
    return null;
  }
}
