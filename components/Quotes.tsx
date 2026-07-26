interface Quote {
  text: string;
  name: string;
  location: string;
}

const QUOTES: Quote[] = [
  {
    text: "I visited 4 chemists and phoned another 5 before giving up and going back to the surgery in absolute agony. It wasted 3 hours of my day.",
    name: "Hannah T.",
    location: "Leeds",
  },
  {
    text: "The pharmacy and GP surgery seem to expect the patient to do all the work. Logically they should just have a database so they can see what's available where.",
    name: "Marcus D.",
    location: "Bristol",
  },
  {
    text: "Every time I have to get a prescription, I ring between 30 to 40 pharmacies. It's just been really hard to get hold of the stuff.",
    name: "Priya S.",
    location: "Manchester",
  },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Quotes() {
  return (
    <section className="py-20 sm:py-28">
      <div className="shell">
        <div className="max-w-2xl">
          <p className="flex items-center gap-3 text-[15px] font-medium text-teal">
            <span className="h-px w-8 bg-teal/40" aria-hidden="true" />
            Why we built Relay
          </p>
          <h2 className="display mt-4 text-[2rem] text-ink sm:text-[2.6rem]">
            The patient is left to do the calling.
          </h2>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {QUOTES.map((quote) => (
            <figure
              key={quote.name}
              className="card card-lift group flex flex-col p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <span
                aria-hidden="true"
                className="font-display text-[3.5rem] leading-[0.6] text-teal/20 transition-colors duration-300 group-hover:text-teal/35"
              >
                &ldquo;
              </span>
              <blockquote className="mt-3 flex-1 text-[1.08rem] leading-relaxed text-ink">
                {quote.text}
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-line pt-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal/10 text-[13px] font-semibold text-teal">
                  {initials(quote.name)}
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-medium text-ink">
                    {quote.name}
                  </span>
                  <span className="block text-xs text-muted">{quote.location}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
