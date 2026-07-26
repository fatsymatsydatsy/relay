interface Shortage {
  name: string;
  detail: string;
  status: "shortage" | "ssp";
}

const SHORTAGES: Shortage[] = [
  { name: "Propranolol 80mg MR", detail: "Anxiety, migraine, heart", status: "shortage" },
  { name: "Ramipril", detail: "Blood pressure", status: "shortage" },
  { name: "Estradot patches", detail: "HRT", status: "ssp" },
  { name: "Creon 10,000", detail: "Pancreatic enzyme", status: "ssp" },
];

function StatusBadge({ status }: { status: Shortage["status"] }) {
  const isSsp = status === "ssp";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-coral/30 bg-coral-soft px-2.5 py-1 text-[11px] font-medium text-coral-deep">
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-coral/60 animate-ring-pulse" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-coral animate-glow" />
      </span>
      {isSsp ? "Active SSP" : "Active shortage"}
    </span>
  );
}

export default function ActiveShortages() {
  return (
    <section id="shortages" className="scroll-mt-20 border-y border-line bg-surface py-20 sm:py-24">
      <div className="shell">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="flex items-center gap-3 text-[15px] font-medium text-teal">
              <span className="h-px w-8 bg-teal/40" aria-hidden="true" />
              Tracked in the UK
            </p>
            <h2 className="display mt-4 text-[2rem] text-ink sm:text-[2.4rem]">
              Current UK medicine shortages
            </h2>
          </div>
          <p className="max-w-xs text-sm text-muted">
            SSP = Serious Shortage Protocol, issued by the DHSC when a medicine
            is scarce nationwide. Listed from DHSC supply notifications, July
            2026.
          </p>
        </div>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2">
          {SHORTAGES.map((drug) => (
            <li
              key={drug.name}
              className="flex items-center justify-between gap-4 rounded-card border border-line bg-paper px-5 py-4"
            >
              <div>
                <p className="font-display text-lg text-ink">{drug.name}</p>
                <p className="text-sm text-muted">{drug.detail}</p>
              </div>
              <StatusBadge status={drug.status} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
