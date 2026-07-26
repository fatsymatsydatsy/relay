import { NextRequest, NextResponse } from "next/server";
import { normalizePostcode } from "@/lib/search/geocode";
import { geocodePostcodeServer } from "@/lib/integrations/geocode";

/**
 * Geocoding proxy for the BROWSER map: the client never talks to postcodes.io
 * directly, so no third party sees the user's IP paired with their postcode
 * (codex review P1-3). Postcodes are validated before leaving our origin and
 * results are cached for a day (postcode coordinates don't move).
 */
export async function GET(req: NextRequest) {
  const normalized = normalizePostcode(req.nextUrl.searchParams.get("postcode") ?? "");
  if (!normalized) {
    return NextResponse.json({ error: "invalid_postcode" }, { status: 400 });
  }

  const point = await geocodePostcodeServer(normalized);
  if (!point) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(point, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" },
  });
}
