import { NextRequest, NextResponse } from "next/server";
import { normalizePostcode } from "@/lib/search/geocode";

/**
 * Server-side geocoding proxy. The browser never talks to postcodes.io
 * directly, so no third party sees the user's IP paired with their postcode
 * (codex review P1-3). Postcodes are validated before leaving our origin and
 * results are cached at the edge for a day (postcode coordinates don't move).
 */
export async function GET(req: NextRequest) {
  const normalized = normalizePostcode(req.nextUrl.searchParams.get("postcode") ?? "");
  if (!normalized) {
    return NextResponse.json({ error: "invalid_postcode" }, { status: 400 });
  }

  const full = await lookup(`postcodes/${encodeURIComponent(normalized)}`);
  if (full) return cached(full);

  // Partial coverage fallback: the outward code (e.g. "B5") still centers the map.
  const outward = normalized.split(" ")[0];
  const partial = await lookup(`outcodes/${encodeURIComponent(outward)}`);
  if (partial) return cached(partial);

  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

function cached(body: { lat: number; lng: number }): NextResponse {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" },
  });
}

interface PostcodesIoResponse {
  result?: { latitude?: number; longitude?: number };
}

async function lookup(path: string): Promise<{ lat: number; lng: number } | null> {
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
