import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="shell flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-md text-sm text-muted">
            Built at the Encode Healthcare Hackathon 2026. Relay checks pharmacy
            stock availability — it does not provide medical advice. Always
            speak to your GP or pharmacist. In an emergency call 999; for
            urgent medicine needs call NHS 111.
          </p>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
          United Kingdom · NHS-aware
        </p>
      </div>
    </footer>
  );
}
