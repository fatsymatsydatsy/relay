import Link from "next/link";
import RelayPanel from "./RelayPanel";
import WaitlistForm from "./WaitlistForm";
import { shouldShowCount } from "@/lib/waitlist";

function HudCard({
  label,
  value,
  unit,
  className,
  delay,
}: {
  label: string;
  value: string;
  unit: string;
  className: string;
  delay: string;
}) {
  return (
    <div
      className={`animate-float-slow absolute hidden w-32 rounded-card border border-line bg-surface/90 p-3 shadow-[0_12px_30px_-16px_rgba(22,36,42,0.4)] backdrop-blur lg:block ${className}`}
      style={{ animationDelay: delay }}
      aria-hidden="true"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p className="figure mt-0.5 text-2xl text-ink">
        {value}
        <span className="ml-1 text-sm font-normal text-muted">{unit}</span>
      </p>
      <span className="mt-2 block h-0.5 w-full rounded-full bg-teal/70" />
    </div>
  );
}

export default function Hero({ count }: { count: number | null }) {
  return (
    <section id="top" className="relative">
      <div className="shell grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pb-24">
        <div className="animate-fade-up">
          <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-coral/60 animate-ring-pulse" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-coral" />
            </span>
            Live UK shortage finder · Free
          </p>

          <h1 className="display mt-5 text-[2.9rem] font-semibold leading-[0.98] tracking-[-0.02em] text-ink sm:text-[4rem] lg:text-[4.5rem]">
            Stop calling
            <br />
            30 pharmacies.
            <br />
            <span className="text-teal">We&apos;ll find it.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[1.05rem] leading-relaxed text-muted">
            Enter your medication and area. Relay&apos;s AI calls nearby
            pharmacies for you, finds who has stock, and tells you exactly what
            to do next.{" "}
            <span className="font-medium text-ink">Free.</span>
          </p>

          <div id="join" className="mt-8 max-w-xl scroll-mt-24">
            <WaitlistForm variant="hero" />
            <p className="mt-3 text-sm text-muted">
              No spam, ever. We&apos;ll notify you when we launch.
              {shouldShowCount(count) && (
                <>
                  {" "}
                  <span className="font-medium text-ink">
                    {count.toLocaleString("en-GB")} people
                  </span>{" "}
                  already joined.
                </>
              )}
            </p>
            <Link
              href="/search"
              className="group mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-teal underline-offset-4 hover:underline"
            >
              See how Relay finds your medication
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </div>
        </div>

        <div
          className="animate-fade-up lg:justify-self-end"
          style={{ animationDelay: "120ms" }}
        >
          <div className="relative mx-auto w-full max-w-md">
            <RelayPanel />
            <HudCard
              label="Nearest"
              value="0.8"
              unit="mi"
              className="-right-6 top-10"
              delay="0.2s"
            />
            <HudCard
              label="Avg time"
              value="4"
              unit="min"
              className="-left-8 bottom-12"
              delay="1.1s"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
