"use client";

import { useMemo } from "react";
import type { PharmacyResult } from "@/lib/search/types";

interface PharmacyMapProps {
  pharmacies: PharmacyResult[];
  postcode: string;
  resolved: boolean;
}

/**
 * Keyless, first-party schematic map (Marvin's F4 ruling): pharmacies plotted
 * by distance + bearing on concentric mile rings around the patient. Zero
 * third-party requests — no tile servers, no geocoding, nothing leaves the
 * page. Deliberately a diagram rather than a street map, so it never implies
 * precise geography the data doesn't have. Replaces the vendored
 * Leaflet/OpenStreetMap variant (requests carried IP + postcode-area, codex
 * P1-3) and the Google variant before it.
 */
export default function PharmacyMap({
  pharmacies,
  postcode,
  resolved,
}: PharmacyMapProps) {
  const maxMiles = useMemo(
    () => Math.max(...pharmacies.map((p) => p.distanceMiles), 0.5),
    [pharmacies],
  );

  // Pixel radius of the outermost ring; pins scale inside it.
  const RADIUS_PX = 118;

  const pins = useMemo(
    () =>
      pharmacies.map((pharmacy) => {
        const r = (pharmacy.distanceMiles / maxMiles) * RADIUS_PX;
        const rad = (pharmacy.bearing * Math.PI) / 180;
        return {
          pharmacy,
          x: Math.sin(rad) * r,
          y: -Math.cos(rad) * r,
        };
      }),
    [pharmacies, maxMiles],
  );

  const best = pharmacies.find((p) => p.phase === "in-stock") ?? null;

  const rings = [1 / 3, 2 / 3, 1];

  return (
    <div
      className="card card-lift relative overflow-hidden"
      role="img"
      aria-label={
        resolved && best
          ? `Diagram of pharmacies near ${postcode.toUpperCase()}. ${best.name} has stock, ${best.distanceMiles} miles away.`
          : `Diagram of pharmacies near ${postcode.toUpperCase()}.`
      }
    >
      <div className="relative h-[300px] w-full overflow-hidden bg-[radial-gradient(circle_at_center,_#f2f6f5_0%,_#e7eeee_100%)]">
        {/* distance rings */}
        {rings.map((f) => (
          <div
            key={f}
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-teal/20"
            style={{ width: f * RADIUS_PX * 2, height: f * RADIUS_PX * 2 }}
          />
        ))}
        {/* ring distance labels */}
        {rings.map((f) => (
          <span
            key={`label-${f}`}
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-wide text-muted/70"
            style={{ top: `calc(50% - ${f * RADIUS_PX + 11}px)` }}
          >
            {(f * maxMiles).toFixed(1)} mi
          </span>
        ))}

        {/* pharmacy pins */}
        {pins.map(({ pharmacy, x, y }) => {
          const active =
            pharmacy.phase === "dialing" || pharmacy.phase === "asking";
          const inStock = pharmacy.phase === "in-stock";
          const outStock = pharmacy.phase === "out-of-stock";
          return (
            <div
              key={pharmacy.id}
              title={`${pharmacy.name} · ${pharmacy.distanceMiles} mi`}
              className="absolute flex h-6 w-6 items-center justify-center"
              style={{
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {inStock ? (
                <span className="relative flex h-6 w-6 animate-pin-drop items-center justify-center rounded-full border-2 border-surface bg-teal shadow-[0_2px_6px_rgba(19,42,36,0.4)]">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <path
                      d="M2.8 6.7 5.3 9.2 10.2 3.6"
                      stroke="#fff"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : (
                <>
                  {active && (
                    <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal/40 animate-ring-pulse" />
                  )}
                  <span
                    className={`relative block h-3.5 w-3.5 rounded-full border-2 border-surface ${
                      outStock ? "bg-line" : active ? "bg-teal" : "bg-muted/50"
                    }`}
                  />
                </>
              )}
            </div>
          );
        })}

        {/* the patient, dead center */}
        <div
          className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          aria-hidden="true"
        >
          <span className="absolute h-6 w-6 rounded-full bg-coral/20" />
          <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-surface bg-coral" />
          <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-pill bg-surface px-2 py-0.5 text-[11px] font-medium text-ink shadow-[0_1px_4px_rgba(19,42,36,0.2)]">
            You · {postcode.toUpperCase()}
          </span>
        </div>

        {/* glass overlay card, same as the tiled map had */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[78%]">
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
            : "Checking nearby pharmacies…"}
        </span>
      </div>
    </div>
  );
}
