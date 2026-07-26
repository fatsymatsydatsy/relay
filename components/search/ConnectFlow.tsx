/**
 * PARKED — not rendered anywhere (flagged decision F3, build-steps.md).
 * A simulated "you're connected to your pharmacy" phone call must never look
 * real (codex review P1-1). Re-enable only when the CONNECT step is backed by
 * an actual bridged call, or explicitly framed as a mock in the demo video.
 */
import type {
  ConnectPhase,
  NominatedPharmacy,
  PharmacyResult,
} from "@/lib/search/types";
import { CallingDots } from "./CallStatus";

interface ConnectFlowProps {
  nominated: NominatedPharmacy;
  best: PharmacyResult;
  phase: ConnectPhase;
  onConnect(): void;
}

export default function ConnectFlow({
  nominated,
  best,
  phase,
  onConnect,
}: ConnectFlowProps) {
  if (phase === "connected") {
    return (
      <div className="card card-lift animate-fade-up border-teal/25 bg-mist p-5 sm:p-6" role="status">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal text-surface">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M2.8 6.7 5.3 9.2 10.2 3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="font-medium text-ink">You&apos;re connected to {nominated.name}</p>
        </div>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
          Ask the pharmacist to release your {best.name === nominated.name ? "" : "prescription"} back to
          the NHS Spine so it can be sent to{" "}
          <span className="font-medium text-ink">{best.name}</span>. You&apos;re
          speaking in your own voice, so they can verify it&apos;s really you.
        </p>
      </div>
    );
  }

  if (phase === "connecting") {
    return (
      <div className="card card-lift p-5 sm:p-6" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-teal/40 animate-ring-pulse" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-teal" />
          </span>
          <p className="flex items-center gap-2 font-medium text-ink">
            Connecting you to {nominated.name} <CallingDots />
          </p>
        </div>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
          You&apos;ll speak directly with the pharmacist to release your
          prescription. Please keep this page open.
        </p>
      </div>
    );
  }

  return (
    <div className="card card-lift p-5 sm:p-6">
      <h3 className="font-display text-lg text-ink">
        Need it released from your current pharmacy?
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Your prescription is currently held at{" "}
        <span className="font-medium text-ink">{nominated.name}</span>. Relay can
        connect you now so you can ask them to release it back to the NHS Spine.
      </p>
      <button
        type="button"
        onClick={onConnect}
        className="btn-primary mt-4 w-full px-6 py-3.5 text-[15px]"
      >
        Connect me to my current pharmacy
      </button>
    </div>
  );
}
