/**
 * The transcript→verdict extraction prompt (the ONLY prompt in the system).
 * Mirrors pharmacy-call-agent-script.md §5 — the transcript is truth; the
 * extractor re-derives the schema from it, never trusts the agent's own
 * summary. Verbatim fields stay verbatim.
 */

export interface ExtractionContext {
  callRef: string;
  medicationDisplay: string;
  quantityNeeded: number;
  expectedPharmacyName: string;
  expectedStreet: string;
  transcript: unknown;
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract a structured stock verdict from the transcript of ONE phone call an AI assistant made to a UK pharmacy on behalf of a patient.

Rules — these mirror hard database constraints, so violations are rejected:
- stock_status may be "in_stock" or "out_of_stock" ONLY when the call completed AND the pharmacy branch was confirmed (location_confirmed = "yes"). Anything else: "unclear" or "not_asked".
- outcome "voicemail", "wrong_location", "national_line": stock fields must be empty (stock_status "not_asked", quantities null, orderable "unknown", eta null).
- Voicemail, answering machines, IVR dead-ends with no human: outcome "voicemail".
- The callee's own greeting naming the pharmacy (matching the expected name, or an obvious variant of it) COUNTS as branch confirmation (location_confirmed = "yes") — the agent deliberately does not re-ask when the greeting already answered it (script v1.3).
- The person says it's a different branch or can't confirm the branch: outcome "wrong_location".
- A human answered, branch confirmed, but they refused, were too busy, or the call ended without a stock answer: outcome "refused" (explicit refusal) or "incomplete".
- ANY amount in stock is in_stock — one box counts. quantity_meets_need is informational only.
- Verbatim fields stay exactly as spoken ("two boxes", "Thursday-ish"). Do NOT normalize numbers or dates.
- Never invent. If the transcript doesn't say it, use "unclear"/"unknown"/null.
- notable_quotes: at most 2 short verbatim quotes that justify the verdict.`;

export function extractionUserPrompt(ctx: ExtractionContext): string {
  return `Call context:
- call_ref (echo this exactly): ${ctx.callRef}
- Medication asked about: ${ctx.medicationDisplay}
- Patient needs: ${ctx.quantityNeeded} pack(s)
- Expected pharmacy: ${ctx.expectedPharmacyName}, ${ctx.expectedStreet}

Transcript (JSON turns, agent = our assistant):
${JSON.stringify(ctx.transcript, null, 2)}

Return the extraction JSON.`;
}

/** §5 as strict JSON schema for OpenAI structured output. */
export const EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    call_ref: { type: "string" },
    outcome: {
      type: "string",
      enum: ["completed", "voicemail", "wrong_location", "national_line", "refused", "incomplete"],
    },
    location_confirmed: { type: "string", enum: ["yes", "no", "unclear"] },
    stock_status: {
      type: "string",
      enum: ["in_stock", "out_of_stock", "unclear", "not_asked"],
    },
    quantity_available_verbatim: { type: ["string", "null"] },
    quantity_meets_need: { type: "string", enum: ["yes", "no", "unknown"] },
    orderable: { type: "string", enum: ["yes", "no", "unknown"] },
    eta_verbatim: { type: ["string", "null"] },
    shortage_mentioned: { type: "boolean" },
    notable_quotes: { type: "array", items: { type: "string" }, maxItems: 2 },
  },
  required: [
    "call_ref",
    "outcome",
    "location_confirmed",
    "stock_status",
    "quantity_available_verbatim",
    "quantity_meets_need",
    "orderable",
    "eta_verbatim",
    "shortage_mentioned",
    "notable_quotes",
  ],
};
