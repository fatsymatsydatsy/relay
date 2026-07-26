import type { PharmacyResult } from "@/lib/search/types";

interface ResultCardProps {
  medication: string;
  dose: string;
  best: PharmacyResult;
  alternatives: PharmacyResult[];
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-teal">
      <path d="M8 1.5c-2.5 0-4.5 2-4.5 4.4C3.5 9.2 8 14.5 8 14.5s4.5-5.3 4.5-8.6C12.5 3.5 10.5 1.5 8 1.5Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="5.9" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-teal">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.6V8l2.4 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ResultCard({
  medication,
  dose,
  best,
  alternatives,
}: ResultCardProps) {
  const doseSuffix = dose ? ` ${dose}` : "";

  return (
    <div className="card card-lift overflow-hidden">
      <div className="border-b border-line bg-mist px-5 py-6 sm:px-6">
        <span className="relative mb-4 flex h-11 w-11 animate-check-in items-center justify-center rounded-full bg-teal text-surface shadow-[0_6px_16px_-4px_rgba(13,82,87,0.55)]">
          <span className="absolute inset-0 rounded-full ring-4 ring-teal/15" aria-hidden="true" />
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 10.4 8.2 14 15.5 5.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-sm font-medium text-teal">Good news</p>
        <h2 className="display mt-1.5 text-2xl text-ink sm:text-[1.8rem]">
          {best.name} has {medication}
          {doseSuffix} in stock
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-pill border border-line bg-surface px-3 py-1 text-xs font-medium text-ink tnum">
            {best.distanceMiles} miles away
          </span>
          <span className="rounded-pill bg-teal/10 px-3 py-1 text-xs font-medium text-teal">
            Nearest with stock
          </span>
        </div>
      </div>

      <div className="stagger grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6">
        <div className="flex items-start gap-2.5">
          <PinIcon />
          <div>
            <p className="text-sm text-ink">{best.address}</p>
            <p className="text-sm text-muted">
              {best.road} · {best.distanceMiles} miles away
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <ClockIcon />
          <div>
            <p className="text-sm text-ink">{best.hours}</p>
            <p className="text-sm text-muted tnum">{best.phone}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-line px-5 py-5 sm:px-6">
        <h3 className="text-sm font-medium text-ink">What to do next</h3>
        <ol className="stagger mt-3 flex flex-col gap-3">
          <li className="flex gap-3">
            <span className="figure mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal text-[13px] text-surface">
              1
            </span>
            <p className="text-[15px] leading-relaxed text-muted">
              Change your pharmacy nomination to{" "}
              <span className="font-medium text-ink">{best.name}</span> in the NHS
              App, so your prescription is sent there.
            </p>
          </li>
          <li className="flex gap-3">
            <span className="figure mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal text-[13px] text-surface">
              2
            </span>
            <p className="text-[15px] leading-relaxed text-muted">
              Or call {best.name} on{" "}
              <span className="tnum text-ink">{best.phone}</span> and give them
              your NHS number, so they can pull your prescription down.
            </p>
          </li>
        </ol>

        {alternatives.length > 0 && (
          <p className="mt-4 rounded-[10px] bg-mist px-3.5 py-2.5 text-sm text-muted">
            Also in stock:{" "}
            {alternatives.map((alt, i) => (
              <span key={alt.id}>
                <span className="font-medium text-ink">{alt.name}</span> (
                {alt.distanceMiles} mi){i < alternatives.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
