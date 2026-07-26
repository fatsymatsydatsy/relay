/**
 * Persistent disclosure shown on every simulated stage of /search: scripted
 * demo output must be impossible to mistake for real calls (codex P1-1).
 * Not rendered when the engine is "live".
 */
export default function DemoBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-card border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-deep"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <path
          d="M8 1.5 15 14H1L8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8" cy="11.7" r="0.9" fill="currentColor" />
      </svg>
      <span>
        <span className="font-semibold">Demo mode — simulated data.</span> No
        pharmacies are being called and stock results are fictional.
      </span>
    </div>
  );
}
