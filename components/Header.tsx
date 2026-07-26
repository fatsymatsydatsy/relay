import Link from "next/link";
import Logo from "./Logo";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 pt-3 sm:pt-4">
      <div className="shell">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 rounded-pill border border-line/80 bg-surface/75 pl-5 pr-2 shadow-[0_8px_30px_-16px_rgba(22,36,42,0.35)] backdrop-blur-md">
          <a href="#top" aria-label="Relay home" className="rounded-md">
            <Logo />
          </a>
          <div className="flex items-center gap-1 sm:gap-2">
            <a
              href="#how-it-works"
              className="hidden rounded-pill px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:inline-block"
            >
              How it works
            </a>
            <a
              href="#shortages"
              className="hidden rounded-pill px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:inline-block"
            >
              Shortages
            </a>
            <Link
              href="/search"
              className="hidden rounded-pill px-3 py-2 text-sm text-muted transition-colors hover:text-ink sm:inline-block"
            >
              Find medication
            </Link>
            <a href="#join" className="btn-primary px-4 py-2.5 text-sm">
              Join waitlist
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
