const ITEMS = [
  "Propranolol 80mg MR",
  "Ramipril",
  "Estradot patches",
  "Creon 10,000",
  "Oestrogel",
  "Methylphenidate",
  "Levothyroxine",
  "Amoxicillin",
  "HRT patches",
];

function Row() {
  return (
    <div className="flex shrink-0 items-center gap-8 pr-8" aria-hidden="true">
      {ITEMS.map((item) => (
        <span key={item} className="flex items-center gap-8">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-coral animate-glow" />
          <span className="whitespace-nowrap font-mono text-xs uppercase tracking-[0.14em] text-muted">
            {item}
          </span>
        </span>
      ))}
    </div>
  );
}

/** A continuously scrolling "live shortage feed" — Sol-style motion ticker. */
export default function ShortageTicker() {
  return (
    <section
      className="relative overflow-hidden border-y border-line bg-surface py-3"
      aria-label="Medications currently in short supply across the UK"
    >
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused] motion-reduce:animate-none">
        <Row />
        <Row />
      </div>
      {/* soft edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-surface to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-surface to-transparent" />
    </section>
  );
}
