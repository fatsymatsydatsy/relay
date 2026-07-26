"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import type { PharmacyResult } from "@/lib/search/types";
import {
  escapeHtml,
  geocodePostcode,
  offsetLatLng,
  type LatLng,
} from "@/lib/search/geocode";

interface LeafletPharmacyMapProps {
  pharmacies: PharmacyResult[];
  postcode: string;
  resolved: boolean;
}

function pinIcon(pharmacy: PharmacyResult): L.DivIcon {
  const active = pharmacy.phase === "dialing" || pharmacy.phase === "asking";
  const inStock = pharmacy.phase === "in-stock";
  const outStock = pharmacy.phase === "out-of-stock";

  let inner: string;
  if (inStock) {
    inner = `<span class="relative flex h-6 w-6 animate-pin-drop items-center justify-center rounded-full border-2 border-surface bg-teal shadow-[0_2px_6px_rgba(19,42,36,0.4)]">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.8 6.7 5.3 9.2 10.2 3.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>`;
  } else {
    const color = outStock ? "#c2cdc8" : active ? "#0D5257" : "#8a9a93";
    const ring = active
      ? `<span class="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal/40 animate-ring-pulse"></span>`
      : "";
    inner = `${ring}<span class="relative block h-3.5 w-3.5 rounded-full border-2 border-surface" style="background:${color}"></span>`;
  }

  return L.divIcon({
    className: "relay-pin",
    html: `<div class="relative flex h-6 w-6 items-center justify-center">${inner}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function patientIcon(postcode: string): L.DivIcon {
  // DivIcon html lands in innerHTML — user text is escaped even though the
  // form already validates postcodes (defense in depth, codex P1-4).
  const label = escapeHtml(postcode.toUpperCase());
  return L.divIcon({
    className: "relay-pin",
    html: `<div class="relative flex h-6 w-6 items-center justify-center">
      <span class="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coral/20"></span>
      <span class="relative block h-3.5 w-3.5 rounded-full border-2 border-surface bg-coral"></span>
      <span class="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-pill bg-surface px-2 py-0.5 text-[11px] font-medium text-ink shadow-[0_1px_4px_rgba(19,42,36,0.2)]">You · ${label}</span>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** Keeps the viewport framed around the patient and all pharmacy pins. */
function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [48, 48] });
  }, [map, points]);
  return null;
}

export default function LeafletPharmacyMap({
  pharmacies,
  postcode,
  resolved,
}: LeafletPharmacyMapProps) {
  // null = loading · "failed" = could not geocode (explicit state, never a
  // silent fallback city — codex P2-1)
  const [center, setCenter] = useState<LatLng | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    geocodePostcode(postcode).then((result) => {
      if (!cancelled) setCenter(result ?? "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [postcode]);

  const origin = center !== null && center !== "failed" ? center : null;

  const points = useMemo(() => {
    if (!origin) return [];
    return pharmacies.map((pharmacy) => ({
      pharmacy,
      position: offsetLatLng(origin, pharmacy.distanceMiles, pharmacy.bearing),
    }));
  }, [origin, pharmacies]);

  const best = pharmacies.find((p) => p.phase === "in-stock") ?? null;

  if (center === null) {
    return (
      <div className="card flex h-[300px] items-center justify-center text-sm text-muted">
        Loading map…
      </div>
    );
  }

  if (center === "failed" || !origin) {
    return (
      <div className="card flex h-[120px] flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-ink">
          We couldn&apos;t place {postcode.toUpperCase()} on the map.
        </p>
        <p className="text-sm text-muted">
          Check the postcode — the call results below still update.
        </p>
      </div>
    );
  }

  const boundsPoints: LatLng[] = [center, ...points.map((p) => p.position)];

  return (
    <div
      className="card card-lift relative overflow-hidden"
      role="group"
      aria-label={
        resolved && best
          ? `Map of pharmacies near ${postcode.toUpperCase()}. ${best.name} has stock, ${best.distanceMiles} miles away.`
          : `Map of pharmacies near ${postcode.toUpperCase()}.`
      }
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={14}
        scrollWheelZoom={false}
        zoomControl={false}
        style={{ height: "300px", width: "100%" }}
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomleft" />
        <FitBounds points={boundsPoints} />
        <Marker position={[center.lat, center.lng]} icon={patientIcon(postcode)} />
        {points.map(({ pharmacy, position }) => (
          <Marker
            key={pharmacy.id}
            position={[position.lat, position.lng]}
            icon={pinIcon(pharmacy)}
          />
        ))}
      </MapContainer>

      {/* Juno-style glass overlay card floating on the map */}
      <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-[78%]">
        <div className="rounded-[12px] border border-white/50 bg-white/70 px-3.5 py-2.5 shadow-[0_10px_28px_-12px_rgba(22,36,42,0.5)] backdrop-blur-md">
          {resolved && best ? (
            <>
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                In stock
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">{best.name}</p>
              <p className="text-xs text-muted tnum">
                {best.distanceMiles} miles away
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-coral-deep">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 rounded-full bg-coral/60 animate-ring-pulse" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-coral" />
                </span>
                Searching
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                Calling nearby pharmacies…
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <span className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-coral" aria-hidden="true" />
            You
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal" aria-hidden="true" />
            In stock
          </span>
        </span>
        <span className="text-xs font-medium text-teal">
          {resolved && best
            ? `Nearest: ${best.name} · ${best.distanceMiles} mi`
            : "Locating pharmacies…"}
        </span>
      </div>
    </div>
  );
}
