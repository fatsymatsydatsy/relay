import type { CallPhase } from "@/lib/search/types";

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
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {active && (
        <span className="absolute inset-0 rounded-full bg-teal/40 animate-ring-pulse" />
      )}
      <span
        className={`relative h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
          phase === "in-stock"
            ? "bg-teal"
            : phase === "out-of-stock"
              ? "bg-line"
              : active
                ? "bg-teal"
                : "bg-muted/30"
        }`}
      />
    </span>
  );
}

export function StatusTag({ phase }: { phase: CallPhase }) {
  switch (phase) {
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
    case "in-stock":
      return (
        <span className="flex items-center gap-1.5 rounded-pill bg-teal/10 px-2.5 py-1 text-xs font-medium text-teal animate-check-in">
          <CheckIcon />
          In stock
        </span>
      );
    case "out-of-stock":
      return (
        <span className="flex items-center gap-1.5 rounded-pill bg-line/60 px-2.5 py-1 text-xs font-medium text-muted animate-check-in">
          <CrossIcon />
          No stock
        </span>
      );
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
