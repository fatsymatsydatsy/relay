"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Circle,
  GoogleMap,
  OverlayView,
  useJsApiLoader,
} from "@react-google-maps/api";
import type { PharmacyResult } from "@/lib/search/types";
import { geocodePostcode, offsetLatLng, type LatLng } from "@/lib/search/geocode";
import PharmacyMap from "./PharmacyMap";

interface GooglePharmacyMapProps {
  apiKey: string;
  pharmacies: PharmacyResult[];
  postcode: string;
  resolved: boolean;
}

/** Colourful but cohesive map: green parkland, blue water, amber highways,
 *  and a medical-pink tint on hospitals/pharmacies — with teal pins on top. */
const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#eaf3ea" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4f6b5d" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }, { weight: 2 }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#dcedde" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", elementType: "geometry", stylers: [{ color: "#e7ecdf" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#b8e2be" }] },
  { featureType: "poi.medical", elementType: "geometry", stylers: [{ color: "#f6d5c9" }] },
  { featureType: "poi.school", elementType: "geometry", stylers: [{ color: "#eee6cf" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#dfe6e0" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f8e3a6" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#edcd80" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#9c7d33" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#dcc9e4" }] },
  { featureType: "transit.station", elementType: "geometry", stylers: [{ color: "#e6d8ed" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#a2d4e8" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5b93a8" }] },
];

const centerOffset = () => ({ x: 0, y: 0 });
const MILES_TO_M = 1609.34;

function PharmacyMarker({
  pharmacy,
  best,
}: {
  pharmacy: PharmacyResult;
  best: boolean;
}) {
  const active = pharmacy.phase === "dialing" || pharmacy.phase === "asking";
  const inStock = pharmacy.phase === "in-stock";
  const outStock = pharmacy.phase === "no-stock" || pharmacy.phase === "expired";

  return (
    <div className="relative -translate-x-1/2 -translate-y-1/2">
      {active && (
        <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal/35 animate-ring-pulse" />
      )}
      {inStock ? (
        <span className="relative block animate-pin-drop">
          {best && (
            <span className="absolute -inset-1.5 rounded-full border border-teal/40" />
          )}
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-teal shadow-[0_3px_8px_rgba(13,82,87,0.45)]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.2 5.7 9.8 11 4.1" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      ) : (
        <span
          className={`relative block rounded-full border-2 border-surface shadow-[0_2px_5px_rgba(19,42,36,0.3)] ${
            active ? "h-4 w-4" : "h-3.5 w-3.5"
          }`}
          style={{ background: outStock ? "#c2cdc8" : active ? "#0D5257" : "#8a9a93" }}
        />
      )}
    </div>
  );
}

export default function GooglePharmacyMap({
  apiKey,
  pharmacies,
  postcode,
  resolved,
}: GooglePharmacyMapProps) {
  const { isLoaded } = useJsApiLoader({
    id: "relay-google-maps",
    googleMapsApiKey: apiKey,
  });

  const [center, setCenter] = useState<LatLng | null>(null);
  // Our geocode returns null on failure (P2-1: never silently substitute a
  // default city) — on null we fall back to the schematic radar map instead.
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    geocodePostcode(postcode).then((result) => {
      if (cancelled) return;
      if (result) setCenter(result);
      else setGeocodeFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [postcode]);

  const points = useMemo(() => {
    if (!center) return [];
    return pharmacies.map((pharmacy) => ({
      pharmacy,
      position: offsetLatLng(center, pharmacy.distanceMiles, pharmacy.bearing),
    }));
  }, [center, pharmacies]);

  const best = pharmacies.find((p) => p.phase === "in-stock") ?? null;
  const bestPoint = points.find((p) => p.pharmacy.id === best?.id) ?? null;
  const maxMiles = pharmacies.reduce((m, p) => Math.max(m, p.distanceMiles), 1);

  useEffect(() => {
    if (!map || !center || points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(center);
    points.forEach((p) => bounds.extend(p.position));
    map.fitBounds(bounds, 64);
  }, [map, center, points]);

  if (geocodeFailed) {
    // explicit fallback, never a wrong city: the schematic radar map works
    // from distance/bearing alone
    return <PharmacyMap pharmacies={pharmacies} postcode={postcode} resolved={resolved} />;
  }

  if (!isLoaded || !center) {
    return (
      <div className="card flex h-[320px] items-center justify-center text-sm text-muted">
        Loading map…
      </div>
    );
  }

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
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "320px" }}
        center={center}
        zoom={14}
        onLoad={(m) => setMap(m)}
        onUnmount={() => setMap(null)}
        options={{
          styles: MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
          keyboardShortcuts: false,
          backgroundColor: "#eaf3ea",
        }}
      >
        {/* Search-radius ring around the patient */}
        <Circle
          center={center}
          radius={maxMiles * MILES_TO_M * 1.08}
          options={{
            strokeColor: "#0D5257",
            strokeOpacity: 0.28,
            strokeWeight: 1,
            fillColor: "#0D5257",
            fillOpacity: 0.05,
            clickable: false,
          }}
        />

        {points.map(({ pharmacy, position }) => (
          <OverlayView
            key={pharmacy.id}
            position={position}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={centerOffset}
          >
            <PharmacyMarker pharmacy={pharmacy} best={pharmacy.id === best?.id} />
          </OverlayView>
        ))}

        {/* Callout on the found pharmacy */}
        {resolved && best && bestPoint && (
          <OverlayView
            position={bestPoint.position}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={centerOffset}
          >
            <div className="-translate-x-1/2 -translate-y-[calc(100%+18px)] animate-fade-swap">
              <span className="block whitespace-nowrap rounded-pill bg-teal px-2.5 py-1 text-[11px] font-medium text-surface shadow-[0_3px_10px_rgba(13,82,87,0.4)]">
                {best.name} · {best.distanceMiles} mi
              </span>
            </div>
          </OverlayView>
        )}

        {/* Patient marker */}
        <OverlayView
          position={center}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          getPixelPositionOffset={centerOffset}
        >
          <div className="relative -translate-x-1/2 -translate-y-1/2">
            {!resolved && (
              <span className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coral/25 animate-ring-pulse" />
            )}
            <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coral/20" />
            <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-surface bg-coral shadow-[0_2px_5px_rgba(19,42,36,0.3)]" />
          </div>
        </OverlayView>
      </GoogleMap>

      {/* Juno-style glass overlay card floating on the map */}
      <div className="pointer-events-none absolute left-3 top-3 z-[1] max-w-[78%]">
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
            You · {postcode.toUpperCase()}
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
