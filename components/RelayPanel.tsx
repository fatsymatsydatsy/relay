"use client";

import { useEffect, useRef, useState } from "react";
import {
  MEDICATIONS,
  PHARMACIES,
  ROUND_END,
  phaseFor,
  type DemoCallPhase,
  type Pharmacy,
} from "@/lib/pharmacies";

const HOLD_MS = 2600;
const TICK_MS = 120;
const LOOP_MS = ROUND_END + HOLD_MS;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function Waveform() {
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

function CallingDots() {
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

function StatusTag({ phase }: { phase: DemoCallPhase }) {
  switch (phase) {
    case "queued":
      return <span className="font-mono text-xs text-muted/70">Queued</span>;
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
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 6.2 5 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          In stock
        </span>
      );
    case "out-of-stock":
      return (
        <span className="flex items-center gap-1.5 rounded-pill bg-line/60 px-2.5 py-1 text-xs font-medium text-muted animate-check-in">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          No stock
        </span>
      );
  }
}

function CallRow({ pharmacy, phase }: { pharmacy: Pharmacy; phase: DemoCallPhase }) {
  const active = phase === "dialing" || phase === "asking";
  return (
    <li
      className={`relative flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3 transition-colors duration-300 ${
        active ? "border-teal/30 bg-mist" : "border-transparent bg-transparent"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
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
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">
            {pharmacy.name}
          </span>
          <span className="block truncate text-xs text-muted">
            {pharmacy.road}
          </span>
        </span>
      </div>
      <StatusTag phase={phase} />
    </li>
  );
}

export default function RelayPanel() {
  const reduced = usePrefersReducedMotion();
  const [absMs, setAbsMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setAbsMs(ROUND_END); // first round, fully resolved, static
      return;
    }
    let timer: number;
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      setAbsMs(now - startRef.current);
      timer = window.setTimeout(
        () => requestAnimationFrame(tick),
        TICK_MS,
      ) as unknown as number;
    };
    const frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [reduced]);

  const round = Math.floor(absMs / LOOP_MS);
  const elapsed = absMs % LOOP_MS;
  const medication = MEDICATIONS[round % MEDICATIONS.length];
  const winner = PHARMACIES[medication.winner];

  const allResolved = elapsed >= ROUND_END;

  return (
    <div
      className="card w-full overflow-hidden shadow-[0_1px_2px_rgba(19,42,36,0.04),0_14px_36px_-20px_rgba(19,42,36,0.28)]"
      role="img"
      aria-label={`Demonstration of Relay calling nearby pharmacies in parallel to check stock; ${winner.name} has the medication in stock.`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-coral/50 animate-ring-pulse" />
            <span className="relative h-2 w-2 rounded-full bg-coral" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Relay · demo round
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted tnum">
          SW1A · 5 pharmacies
        </span>
      </div>

      <div className="px-4 pt-3.5 pb-1">
        <p className="text-xs text-muted">Looking for</p>
        <div className="h-7 overflow-hidden">
          <p
            key={medication.name}
            className="display animate-fade-swap truncate text-lg leading-7 text-ink"
          >
            {medication.name}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-0.5 px-2.5 pb-2 pt-1" aria-hidden="true">
        {PHARMACIES.map((pharmacy, i) => (
          <CallRow
            key={pharmacy.name}
            pharmacy={pharmacy}
            phase={phaseFor(elapsed, pharmacy, i === medication.winner)}
          />
        ))}
      </ul>

      <div className="border-t border-line px-4 py-3">
        <div
          className={`flex min-h-[2.5rem] items-start gap-2 text-sm transition-opacity duration-500 ${
            allResolved ? "opacity-100" : "opacity-0"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-0.5 shrink-0 text-teal">
            <path d="M3.5 8.2 6.5 11 12.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-ink">
            <span className="font-medium">{winner.name}</span> has it — with the
            address, distance and opening hours.
          </span>
        </div>
      </div>
    </div>
  );
}
