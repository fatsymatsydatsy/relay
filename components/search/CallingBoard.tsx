import type { PharmacyResult, SearchRequest } from "@/lib/search/types";
import { StatusDot, StatusTag } from "./CallStatus";

interface CallingBoardProps {
  request: SearchRequest;
  pharmacies: PharmacyResult[];
  resolved: boolean;
  /** Scripted demo data — the header must say so, never "live" (codex P1-1). */
  simulated?: boolean;
}

function CallRow({ pharmacy, index }: { pharmacy: PharmacyResult; index: number }) {
  const active = pharmacy.phase === "dialing" || pharmacy.phase === "asking";
  const inStock = pharmacy.phase === "in-stock";
  return (
    <li
      className={`flex animate-fade-up items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3 transition-all duration-300 ${
        inStock
          ? "border-teal/30 bg-teal/[0.06]"
          : active
            ? "border-teal/30 bg-mist"
            : "border-transparent"
      }`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot phase={pharmacy.phase} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">
            {pharmacy.name}
          </span>
          <span className="block truncate text-xs text-muted">
            {pharmacy.road} · {pharmacy.distanceMiles} mi
          </span>
        </span>
      </div>
      <StatusTag phase={pharmacy.phase} />
    </li>
  );
}

export default function CallingBoard({
  request,
  pharmacies,
  resolved,
  simulated = false,
}: CallingBoardProps) {
  const inStockCount = pharmacies.filter((p) => p.phase === "in-stock").length;
  const doseSuffix = request.dose ? ` ${request.dose}` : "";

  return (
    <div className="card card-lift overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {!resolved && (
              <span className="absolute inset-0 rounded-full bg-coral/50 animate-ring-pulse" />
            )}
            <span
              className={`relative h-2 w-2 rounded-full ${resolved ? "bg-teal" : "bg-coral"}`}
            />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            {resolved
              ? simulated
                ? "Relay · demo complete"
                : "Relay · search complete"
              : simulated
                ? "Relay · demo simulation"
                : "Relay · calling live"}
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted tnum">
          {request.postcode.toUpperCase()} · {pharmacies.length} calls
        </span>
      </div>

      <div className="px-4 pt-3.5 pb-1">
        <p className="text-xs text-muted">Looking for</p>
        <p className="display text-lg text-ink">
          {request.medication}
          {doseSuffix}
        </p>
      </div>

      <ul className="flex flex-col gap-0.5 px-2.5 pb-3 pt-1">
        {pharmacies.map((pharmacy, i) => (
          <CallRow key={pharmacy.id} pharmacy={pharmacy} index={i} />
        ))}
      </ul>

      <div
        aria-live="polite"
        className="border-t border-line px-4 py-3 text-sm text-muted"
      >
        {resolved ? (
          <span className="text-ink">
            <span className="font-medium">
              {inStockCount} {inStockCount === 1 ? "pharmacy has" : "pharmacies have"}
            </span>{" "}
            your medication in stock.
          </span>
        ) : (
          <span>Calling nearby pharmacies. This usually takes under a minute…</span>
        )}
      </div>
    </div>
  );
}
