/**
 * 5.2.1 — evidence report builder (pure; the script does the I/O).
 *
 * Turns the four log layers of one search (searches row, calls rows,
 * dial_log, call_events counts) into a markdown report safe to commit to a
 * PUBLIC repo:
 *
 *  - transcript bodies NEVER appear — this module never reads `.transcript`;
 *    the report says where the raw evidence lives instead (Postgres,
 *    append-only). Verbatim quotes stay in the service-only `extraction`
 *    column per audit P1-4.
 *  - DEV_TEST rows mask the resolved number to its last 6 digits (team
 *    phones are personal). REAL rows print the full number: it is public
 *    NHS directory data and IS the evidence.
 *  - the politeness proof is computed, not asserted: duplicate dials are
 *    flagged loudly rather than averaged away.
 */
import type { VerdictJson } from "./verdict";

export interface EvidenceSearch {
  id: string;
  dial_mode: string;
  medication_name: string;
  quantity_needed: number;
  postcode: string;
  status: string;
  created_at: string;
  deadline_at: string | null;
  settled_at: string | null;
}

export interface EvidenceCall {
  pharmacy_name: string;
  pharmacy_ods: string;
  status: string;
  is_bench: boolean;
  dial_mode: string | null;
  resolved_number: string | null;
  claimed_at: string | null;
  ended_at: string | null;
  verdict_at: string | null;
  rank_bucket: number | null;
  location_confirmed: string | null;
  verdict: VerdictJson | null;
  /** May arrive from a sloppy select — deliberately ignored, never rendered. */
  transcript?: unknown;
}

export interface EvidenceDial {
  phone: string;
  outcome: string;
  dialed_at: string;
}

export interface EvidenceInput {
  search: EvidenceSearch;
  calls: EvidenceCall[];
  dialLog: EvidenceDial[];
  /** event_type → count, from call_events for this search's calls. */
  eventCounts: Record<string, number>;
  generatedAt: string;
}

const hhmmss = (iso: string | null): string =>
  iso ? new Date(iso).toISOString().slice(11, 19) : "—";

/** DEV_TEST team phones are personal; last 6 digits only, everywhere. */
export const maskPhoneLast6 = (phone: string): string => `…${phone.slice(-6)}`;

function duration(fromIso: string, toIso: string | null): string {
  if (!toIso) return "not settled";
  const s = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** DEV_TEST team phones are personal — last 6 only. REAL numbers are public. */
function renderNumber(call: EvidenceCall): string {
  if (!call.resolved_number) return "—";
  if (call.dial_mode === "DEV_TEST") return maskPhoneLast6(call.resolved_number);
  return call.resolved_number;
}

function renderOutcome(call: EvidenceCall): string {
  if (call.is_bench && !call.claimed_at) return "bench, never dialed";
  const bucket = call.rank_bucket ? `b${call.rank_bucket} ` : "";
  const v = call.verdict;
  // Bucket 4 = unreached/unverified and is NEVER a stock verdict (core
  // invariant) — render the status alone even if a verdict object is
  // smuggled into the row; the DB constraints forbid it upstream too.
  if (call.rank_bucket === 4 || !v) return `${bucket}${call.status}`;
  const parts: string[] = [`${bucket}${v.stock_status}`];
  if (v.quantity_available !== null) {
    parts.push(`${v.quantity_available} ${v.quantity_unit ?? "units"}`.trim());
  }
  if (v.quantity_meets_need === "yes") parts.push("meets need");
  if (v.eta_label) parts.push(`"${v.eta_label}"`);
  return parts.join(" — ");
}

export function buildEvidenceReport(input: EvidenceInput): string {
  const { search, calls, dialLog, eventCounts } = input;

  const dialed = calls.filter((c) => c.claimed_at !== null);
  // Only 'connected' rows are dials that actually went out. 'freed' means the
  // provider rejected before ringing (the number unblocked; a later claim may
  // legitimately re-insert the same phone) and 'reserved' is in-flight right
  // now — counting either as a dial would cry DUPLICATE on a clean run.
  const connected = dialLog.filter((d) => d.outcome === "connected");
  const freed = dialLog.filter((d) => d.outcome === "freed").length;
  const reserved = dialLog.filter((d) => d.outcome === "reserved").length;
  const distinctNumbers = new Set(connected.map((d) => d.phone));
  const duplicates = connected.length - distinctNumbers.size;
  const webhookTotal = Object.values(eventCounts).reduce((a, b) => a + b, 0);

  const callRows = calls
    .map(
      (c) =>
        `| ${c.pharmacy_name} | ${c.pharmacy_ods} | ${renderNumber(c)} | ` +
        `${hhmmss(c.claimed_at)} | ${hhmmss(c.ended_at)} | ${renderOutcome(c)} |`,
    )
    .join("\n");

  const eventRows = Object.entries(eventCounts)
    .map(([type, n]) => `  - ${type}: ${n}`)
    .join("\n");

  const politeness =
    duplicates === 0
      ? `Politeness: every dialed number distinct — one dial per number held ` +
        `(${connected.length} connected dials, ${distinctNumbers.size} numbers).`
      : `⚠️ DUPLICATE DIALS: ${connected.length} connected dial_log rows across only ` +
        `${distinctNumbers.size} distinct numbers (${duplicates} repeat${duplicates === 1 ? "" : "s"}) — investigate before trusting this run.`;
  const nonDials =
    freed || reserved
      ? `\nAlso in dial_log, not dials: ${freed} freed (provider reject — number unblocked), ${reserved} reserved (in flight at archive time).`
      : "";

  return `# ${search.dial_mode} verification run — ${search.medication_name} (${input.generatedAt.slice(0, 10)})

Search \`${search.id}\` · ${search.medication_name} ×${search.quantity_needed} · ${search.postcode} ·
\`?engine=live\`, DIAL_MODE=${search.dial_mode} · status **${search.status}** ·
created ${hhmmss(search.created_at)} → settled ${hhmmss(search.settled_at)} UTC (**${duration(search.created_at, search.settled_at)}**)

## Cross-verified counts (independent log layers)

| Layer | Count |
|---|---|
| calls rows dialed | ${dialed.length} |
| dial_log connected | ${connected.length} (${distinctNumbers.size} distinct numbers) |
| call_events webhooks | ${webhookTotal} |

${politeness}${nonDials}

Webhook events by type:
${eventRows || "  - none recorded"}

## Call outcomes

| Pharmacy | ODS | Number | Claimed | Ended | Outcome |
|---|---|---|---|---|---|
${callRows}

Buckets: b1 in stock · b2 orderable · b3 out of stock · b4 unreached/unverified
(b4 is never a stock verdict — honesty rule).

Raw transcripts remain in Postgres (\`calls.transcript\`, append-only) and are
deliberately NOT reproduced here; verbatim quotes live in the service-only
\`calls.extraction\` column. Generated ${input.generatedAt} by \`scripts/archive-evidence.ts\`.
`;
}
