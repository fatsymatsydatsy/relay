/**
 * Compact always-in-view safety copy for the /search workflow — the footer
 * carries the full disclaimer, but the hard rule is "disclaimer always
 * visible", including mid-flow on a phone (codex P2-2; runbook §UI contract).
 */
export default function SafetyLine() {
  return (
    <p className="text-[13px] leading-relaxed text-muted">
      Relay checks stock availability — it is not medical advice. In an
      emergency call <span className="font-medium text-ink">999</span>; for
      urgent medicine needs call{" "}
      <span className="font-medium text-ink">NHS 111</span>.
    </p>
  );
}
