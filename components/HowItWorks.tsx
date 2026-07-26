"use client";

import { useInView } from "./useInView";

interface Step {
  n: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    n: "01",
    title: "Tell us what you need",
    body: "Enter your medication, dose and postcode. It takes about twenty seconds, with no account required.",
  },
  {
    n: "02",
    title: "We call pharmacies for you",
    body: "Relay's AI phones nearby pharmacies at the same time and asks who has your medication in stock. Your name is never shared.",
  },
  {
    n: "03",
    title: "Get the answer",
    body: "See which pharmacy has it, plus the address and opening hours — usually within minutes, not hours.",
  },
  {
    n: "04",
    title: "Connect to your pharmacy",
    body: "When Relay launches in full, one tap will bridge you to your current pharmacy to release your prescription to the one with stock.",
  },
];

export default function HowItWorks() {
  const { ref, inView } = useInView<HTMLOListElement>(0.25);

  return (
    <section id="how-it-works" className="scroll-mt-20 py-20 sm:py-28">
      <div className="shell">
        <div className="max-w-2xl">
          <p className="flex items-center gap-3 text-[15px] font-medium text-teal">
            <span className="h-px w-8 bg-teal/40" aria-hidden="true" />
            How Relay works
          </p>
          <h2 className="display mt-4 text-[2rem] text-ink sm:text-[2.6rem]">
            One request. We do the calling.
          </h2>
          <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">
            The same loop a person would run: searching, then handing the call
            back to you at the moment it matters. Done in minutes.
          </p>
        </div>

        <ol
          ref={ref}
          className="relative mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6"
        >
          {/* Relay line connecting the steps — the call being passed along */}
          <span
            aria-hidden="true"
            className={`absolute left-0 right-0 top-[18px] hidden border-t border-dashed border-teal/25 transition-opacity duration-700 lg:block ${
              inView ? "opacity-100" : "opacity-0"
            }`}
          />
          {STEPS.map((step, i) => (
            <li
              key={step.n}
              className={inView ? "relative animate-fade-up" : "relative opacity-0"}
              style={inView ? { animationDelay: `${i * 180}ms` } : undefined}
            >
              <span className="relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal text-surface shadow-[0_4px_12px_-4px_rgba(13,82,87,0.5)]">
                <span className="figure text-[15px]">{step.n}</span>
              </span>
              <h3 className="mt-5 font-display text-xl text-ink">{step.title}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
