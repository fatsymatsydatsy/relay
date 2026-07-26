"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import Footer from "@/components/Footer";
import StatsBar from "@/components/StatsBar";
import ActiveShortages from "@/components/ActiveShortages";
import Quotes from "@/components/Quotes";
import SearchForm from "@/components/search/SearchForm";
import CallingBoard from "@/components/search/CallingBoard";
import PharmacyMap from "@/components/search/PharmacyMap";
import ResultCard from "@/components/search/ResultCard";
import DemoBanner from "@/components/search/DemoBanner";
import SafetyLine from "@/components/search/SafetyLine";
import { createSimulatedEngine } from "@/lib/search/simulated";
import { capture } from "@/lib/analytics";
import type {
  PharmacyResult,
  SearchHandle,
  SearchRequest,
} from "@/lib/search/types";

type Stage = "form" | "calling" | "results";

const ASSURANCES = [
  "Free to use",
  "No account needed",
  "We never share your identity with pharmacies",
];

const HOW_IT_WORKS = [
  {
    title: "We call, not you",
    body: "Relay phones nearby pharmacies in parallel and asks who has your medication in stock.",
  },
  {
    title: "You get the answer",
    body: "See who has it, how far away they are, and their opening hours — in minutes, not hours.",
  },
  {
    title: "You go collect it",
    body: "Every verdict is timestamped from a real phone conversation, so you know exactly where to go.",
  },
];

export default function SearchPage() {
  // Swap createSimulatedEngine() for the real calling engine when ready —
  // this is the only line that changes. The engine is stable for the session.
  const engine = useMemo(() => createSimulatedEngine(), []);

  const simulated = engine.kind === "simulated";

  const [stage, setStage] = useState<Stage>("form");
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const [pharmacies, setPharmacies] = useState<PharmacyResult[]>([]);
  const [resolved, setResolved] = useState(false);

  const searchHandle = useRef<SearchHandle | null>(null);

  useEffect(() => {
    return () => {
      searchHandle.current?.cancel();
    };
  }, []);

  function handleSearch(req: SearchRequest) {
    // No medication/dose/postcode in analytics — health-search data never
    // leaves our origin (PRODUCT.md privacy rule; capture() also enforces an
    // allowlist).
    capture("medication_searched");
    searchHandle.current?.cancel();
    setRequest(req);
    setResolved(false);
    setStage("calling");
    searchHandle.current = engine.start(req, {
      onUpdate: setPharmacies,
      onComplete: (final) => {
        setPharmacies(final);
        setResolved(true);
        // Let the ranked, fully-resolved board breathe before the results
        // view — it's the artifact the 1.4 gate (and the demo video) reads.
        window.setTimeout(() => setStage("results"), 2600);
      },
    });
  }

  function handleReset() {
    searchHandle.current?.cancel();
    setStage("form");
    setRequest(null);
    setPharmacies([]);
    setResolved(false);
  }

  const inStock = pharmacies.filter((p) => p.phase === "in-stock");
  const best = inStock[0] ?? null;
  const alternatives = inStock.slice(1);
  const orderable = pharmacies.filter((p) => p.phase === "can-order");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 pt-3 sm:pt-4">
        <div className="shell">
          <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 rounded-pill border border-line/80 bg-surface/75 pl-5 pr-2 shadow-[0_8px_30px_-16px_rgba(22,36,42,0.35)] backdrop-blur-md">
            <Link href="/" aria-label="Relay home" className="rounded-md">
              <Logo />
            </Link>
            <div className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/#how-it-works"
                className="hidden rounded-pill px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:inline-block"
              >
                How it works
              </Link>
              <Link href="/#join" className="btn-primary px-4 py-2.5 text-sm">
                Join waitlist
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {stage === "form" && (
          <>
            <section className="shell max-w-2xl animate-fade-up py-10 sm:py-14">
            <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-coral/60 animate-ring-pulse" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-coral" />
              </span>
              Pharmacy stock search · UK
            </p>
            <h1 className="display mt-4 text-[2.6rem] font-semibold leading-[0.98] tracking-[-0.02em] text-ink sm:text-[3.6rem]">
              Find your medication.
            </h1>
            <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">
              Tell us what you need and where you are. Relay calls nearby
              pharmacies and finds who has it in stock.
            </p>

            <div className="card card-lift mt-7 p-5 sm:p-6">
              <SearchForm onSearch={handleSearch} />
            </div>

            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {ASSURANCES.map((item) => (
                <li key={item} className="flex items-center gap-1.5 text-sm text-muted">
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className="text-teal">
                    <path d="M3.2 7.8 6 10.4 11.8 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-4">
              <SafetyLine />
            </div>

            <div className="mt-12 border-t border-line pt-10">
              <h2 className="display text-xl text-ink">How it works</h2>
              <ol className="mt-5 grid gap-6 sm:grid-cols-3">
                {HOW_IT_WORKS.map((step, i) => (
                  <li key={step.title}>
                    <span className="figure flex h-8 w-8 items-center justify-center rounded-full bg-teal/10 text-sm text-teal ring-1 ring-inset ring-teal/20">
                      {i + 1}
                    </span>
                    <h3 className="mt-3 font-display text-lg text-ink">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
            </section>
            <StatsBar />
            <ActiveShortages />
            <Quotes />
          </>
        )}

        {stage === "calling" && request && (
          <section className="shell max-w-2xl py-10 sm:py-14">
            <div className="flex animate-fade-up flex-col gap-5">
            {simulated && <DemoBanner />}
            <PharmacyMap
              pharmacies={pharmacies}
              postcode={request.postcode}
              resolved={resolved}
            />
            <CallingBoard
              request={request}
              pharmacies={pharmacies}
              resolved={resolved}
              simulated={simulated}
            />
            <SafetyLine />
            </div>
          </section>
        )}

        {stage === "results" && request && (
          <section className="shell max-w-2xl py-10 sm:py-14">
          <div className="flex flex-col gap-5">
            {simulated && <DemoBanner />}
            {best ? (
              <>
                <div className="animate-fade-up">
                  <PharmacyMap
                    pharmacies={pharmacies}
                    postcode={request.postcode}
                    resolved
                  />
                </div>
                <div className="animate-fade-up" style={{ animationDelay: "60ms" }}>
                  <ResultCard
                    medication={request.medication}
                    dose={request.dose}
                    quantityNeeded={request.quantity}
                    best={best}
                    alternatives={alternatives}
                    orderable={orderable}
                  />
                </div>
                {/* ConnectFlow (bridge to the nominated pharmacy) is parked
                    until flagged decision F3: a simulated "you're connected"
                    phone call must never appear real (codex P1-1). */}
              </>
            ) : (
              <div className="card animate-fade-up p-6 text-center">
                <h2 className="display text-2xl text-ink">
                  No shelf stock nearby right now
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
                  {orderable.length > 0 ? (
                    <>
                      None had {request.medication} on the shelf, but{" "}
                      <span className="font-medium text-ink">
                        {orderable[0].name}
                      </span>{" "}
                      can order it in
                      {orderable[0].eta ? ` for ${orderable[0].eta}` : ""} —{" "}
                      <span className="tnum text-ink">{orderable[0].phone}</span>.
                    </>
                  ) : (
                    <>
                      None of the pharmacies we called had {request.medication}{" "}
                      in stock. Stock changes daily — try again later, or ask
                      your pharmacist about alternatives.
                    </>
                  )}
                </p>
              </div>
            )}

            <SafetyLine />

            <button
              type="button"
              onClick={handleReset}
              className="self-start text-sm font-medium text-teal underline-offset-4 hover:underline"
            >
              ← Start a new search
            </button>
          </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
