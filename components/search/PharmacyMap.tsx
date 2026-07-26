"use client";

import dynamic from "next/dynamic";
import type { PharmacyResult } from "@/lib/search/types";

interface PharmacyMapProps {
  pharmacies: PharmacyResult[];
  postcode: string;
  resolved: boolean;
}

// Leaflet touches `window` on import, so it must load client-side only.
const LeafletPharmacyMap = dynamic(() => import("./LeafletPharmacyMap"), {
  ssr: false,
  loading: () => (
    <div className="card flex h-[300px] items-center justify-center text-sm text-muted">
      Loading map…
    </div>
  ),
});

/**
 * Real map with pharmacy pins on free OpenStreetMap tiles (no key, no billing).
 * The upstream relay repo also had a Google Maps variant; dropped here because
 * it is dead code without an API key we don't intend to add.
 */
export default function PharmacyMap(props: PharmacyMapProps) {
  return <LeafletPharmacyMap {...props} />;
}
