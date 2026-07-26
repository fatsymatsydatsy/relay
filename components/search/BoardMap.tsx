"use client";

import type { PharmacyResult } from "@/lib/search/types";
import GooglePharmacyMap from "./GooglePharmacyMap";
import PharmacyMap from "./PharmacyMap";

/**
 * 5.2g — the board's map: the REAL Google map when a key is configured
 * (restored from the relay UI repo), the schematic radar otherwise, so a
 * fresh clone with no key still builds and runs.
 */
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

interface BoardMapProps {
  pharmacies: PharmacyResult[];
  postcode: string;
  resolved: boolean;
}

export default function BoardMap(props: BoardMapProps) {
  if (!MAPS_KEY) return <PharmacyMap {...props} />;
  return <GooglePharmacyMap apiKey={MAPS_KEY} {...props} />;
}
