import type { CallPhase, PharmacyResult } from "@/lib/search/types";
import { quantityLabel } from "@/lib/domain/call-presentation";

export function Waveform() {
  return (
    <span className="flex items-end gap-[3px] h-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] h-full origin-bottom rounded-full bg-teal animate-bar-flux"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}

export function CallingDots() {
  return (
    <span className="inline-flex gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-teal animate-dot-bounce"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/** The pulsing status dot at the head of each call row. */
export function StatusDot({ phase }: { phase: CallPhase }) {
  const active = phase === "dialing" || phase === "asking";
  const isBucket4 =
    phase === "unreached" || phase === "unverified" || phase === "expired";
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {active && (
        <span className="absolute inset-0 rounded-full bg-teal/40 animate-ring-pulse" />
      )}
      <span
        className={`relative h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
          phase === "in-stock"
            ? "bg-teal"
            : phase === "can-order"
              ? "bg-teal-soft"
              : phase === "no-stock"
                ? "bg-line"
                : isBucket4
                  ? "border border-muted/50 bg-transparent"
                  : active
                    ? "bg-teal"
                    : "bg-muted/30"
        }`}
      />
    </span>
  );
}

/** Bucket-4 outcomes: hollow, dashed, muted — visibly NOT a stock verdict. */
function NotCheckedTag({ label }: { label: string }) {
  return (
    <span className="rounded-pill border border-dashed border-line px-2.5 py-1 text-xs text-muted">
      {label}
    </span>
  );
}

export function StatusTag({
  pharmacy,
  quantityNeeded,
}: {
  pharmacy: PharmacyResult;
  quantityNeeded: number;
}) {
  switch (pharmacy.phase) {
    case "queued":
      return <span className="font-mono text-xs text-muted">Queued</span>;
    case "dialing":
      return (
        <span className="flex items-center gap-2 font-mono text-xs text-teal">
          Calling <CallingDots />
        </span>
      );
    case "asking":
      return (
        <span className="flex items-center gap-2 font-mono text-xs text-teal">
          Checking stock <Waveform />
        </span>
      );
    case "in-stock": {
      const qty = pharmacy.quantityAvailable;
      const partial = qty != null && qty < quantityNeeded;
      return (
        <span className="flex flex-col items-end gap-0.5">
          <span className="flex items-center gap-1.5 rounded-pill bg-teal/10 px-2.5 py-1 text-xs font-medium text-teal animate-check-in">
            <CheckIcon />
            {qty != null
              ? `In stock — ${quantityLabel(qty, pharmacy.quantityUnit)}`
              : "In stock"}
          </span>
          {partial && (
            <span className="text-[11px] font-medium text-coral-deep">
              you need {quantityNeeded}
            </span>
          )}
        </span>
      );
    }
    case "can-order":
      return (
        <span className="flex items-center gap-1.5 rounded-pill border border-teal/30 bg-surface px-2.5 py-1 text-xs font-medium text-teal-soft animate-check-in">
          <ClockIcon />
          {pharmacy.eta ? `Can order · ${pharmacy.eta}` : "Can order"}
        </span>
      );
    case "no-stock":
      return (
        <span className="flex items-center gap-1.5 rounded-pill bg-line/60 px-2.5 py-1 text-xs font-medium text-muted animate-check-in">
          <CrossIcon />
          No stock
        </span>
      );
    case "unreached":
      return <NotCheckedTag label="Couldn't reach" />;
    case "unverified":
      return <NotCheckedTag label="Couldn't verify branch" />;
    case "expired":
      return <NotCheckedTag label="Not checked in time" />;
  }
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 6.2 5 8.5 9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6 3.6V6l1.8 1.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
