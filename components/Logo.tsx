export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="text-teal"
      >
        {/* Two nodes with a relay arc between them — a call being passed along */}
        <circle cx="5" cy="12" r="2.4" fill="currentColor" />
        <circle cx="19" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M6.8 10.4C9 6.8 15 6.8 17.2 10.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-[19px] font-medium tracking-tight text-ink">
        Relay
      </span>
    </span>
  );
}
