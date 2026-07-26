import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/integrations/supabase";
import { openAiChatJson, type ChatJsonFn } from "@/lib/integrations/openai";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  extractionUserPrompt,
} from "@/lib/prompts/extraction";
import { ExtractionSchema, mapExtraction } from "@/lib/domain/verdict";
import { settleIfDrained } from "@/lib/commands/record_call_event";

/**
 * extract_result (3.4) — stored transcript → schema → verdict row.
 *
 * Model ladder (locked decision): gpt-5.4-mini twice; a third attempt
 * escalates to gpt-5.6-sol; still invalid → terminal `extraction_failed`
 * (honest bucket 4 — never a guessed verdict). Every attempt increments
 * extraction_attempts (DB CHECK caps it at 3). Re-runnable by design: the
 * transcript is append-only truth, and the transition
 * `WHERE status='transcript_ready'` makes repeat invocations no-ops after
 * success (the watchdog re-invokes stuck rows).
 *
 * On a fresh verdict: fan out to same-pharmacy+medication queued calls in
 * OTHER active searches (they get the copy, timestamped with THIS call's
 * confirmation time), then drain-settle the search.
 */

export interface ExtractDeps {
  db?: SupabaseClient;
  llm?: ChatJsonFn;
  now?: Date;
  models?: { primary: string; escalation: string };
}

export interface ExtractOutcome {
  action: "verdict" | "unreached" | "wrong_location" | "extraction_failed" | "noop";
  bucket?: number;
  fannedOut?: number;
}

const MAX_ATTEMPTS = 3;

export async function extractResult(
  callId: string,
  deps: ExtractDeps = {},
): Promise<ExtractOutcome> {
  const db = deps.db ?? serviceClient();
  const llm = deps.llm ?? openAiChatJson;
  const now = deps.now ?? new Date();
  const models = deps.models ?? { primary: "gpt-5.4-mini", escalation: "gpt-5.6-sol" };

  const { data: call } = await db
    .from("calls")
    .select(
      "id, search_id, pharmacy_ods, status, transcript, extraction_attempts, searches!inner(medication_id, quantity_needed), pharmacies!inner(name, address)",
    )
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.status !== "transcript_ready") return { action: "noop" };

  const search = call.searches as unknown as {
    medication_id: string;
    quantity_needed: number;
  };
  const pharmacy = call.pharmacies as unknown as { name: string; address: string };
  const { data: medication } = await db
    .from("medications")
    .select("display")
    .eq("id", search.medication_id)
    .single();

  const userPrompt = extractionUserPrompt({
    callRef: call.id,
    medicationDisplay: medication?.display ?? "the medication",
    quantityNeeded: search.quantity_needed,
    expectedPharmacyName: pharmacy.name,
    expectedStreet: pharmacy.address,
    transcript: call.transcript,
  });

  let attempts = call.extraction_attempts ?? 0;
  let extraction: ReturnType<typeof ExtractionSchema.parse> | null = null;
  let lastError = "";

  while (attempts < MAX_ATTEMPTS && !extraction) {
    const model = attempts < 2 ? models.primary : models.escalation;
    attempts++;
    await db.from("calls").update({ extraction_attempts: attempts }).eq("id", call.id);
    try {
      const rawJson = await llm({
        model,
        system: EXTRACTION_SYSTEM_PROMPT,
        user: userPrompt,
        schemaName: "pharmacy_call_extraction",
        schema: EXTRACTION_JSON_SCHEMA,
      });
      extraction = ExtractionSchema.parse(JSON.parse(rawJson));
    } catch (err) {
      lastError = String(err).slice(0, 500);
    }
  }

  if (!extraction) {
    // honest failure: bucket 4, never a guessed verdict
    const { data: failed } = await db
      .from("calls")
      .update({ status: "extraction_failed", rank_bucket: 4 })
      .eq("id", call.id)
      .eq("status", "transcript_ready")
      .select("id");
    if (failed?.length) {
      await db.from("anomalies").insert({
        kind: "extraction_failed",
        detail: { call_id: call.id, attempts, lastError },
      });
      await settleIfDrained(db, call.search_id, now);
    }
    return { action: "extraction_failed", bucket: 4 };
  }

  const mapped = mapExtraction(extraction, now);
  const { data: updated } = await db
    .from("calls")
    .update({
      status: mapped.dbStatus,
      rank_bucket: mapped.bucket,
      location_confirmed: mapped.locationConfirmed,
      verdict: mapped.verdict,
      verdict_at: mapped.verdict ? now.toISOString() : null,
    })
    .eq("id", call.id)
    .eq("status", "transcript_ready")
    .select("id");
  if (!updated?.length) return { action: "noop" };

  if (mapped.flagNationalLine) {
    await db
      .from("pharmacies")
      .update({ number_type: "national" })
      .eq("ods_code", call.pharmacy_ods);
  }

  // fan out a fresh REAL verdict to same-pharmacy+med queued calls elsewhere
  let fannedOut = 0;
  if (mapped.dbStatus === "verdict" && mapped.verdict) {
    const { data: waiting } = await db
      .from("calls")
      .select("id, search_id, searches!inner(medication_id, status)")
      .eq("pharmacy_ods", call.pharmacy_ods)
      .eq("status", "queued")
      .neq("id", call.id);
    for (const w of waiting ?? []) {
      const s = w.searches as unknown as { medication_id: string; status: string };
      if (s.medication_id !== search.medication_id || s.status !== "active") continue;
      const { data: copied } = await db
        .from("calls")
        .update({
          status: "verdict",
          rank_bucket: mapped.bucket,
          location_confirmed: mapped.locationConfirmed,
          verdict: mapped.verdict,
          verdict_at: now.toISOString(),
          copied_from_call_id: call.id,
        })
        .eq("id", w.id)
        .eq("status", "queued")
        .select("id");
      if (copied?.length) {
        fannedOut++;
        await settleIfDrained(db, w.search_id, now);
      }
    }
  }

  await settleIfDrained(db, call.search_id, now);
  return {
    action:
      mapped.dbStatus === "verdict"
        ? "verdict"
        : mapped.dbStatus === "unreached"
          ? "unreached"
          : "wrong_location",
    bucket: mapped.bucket,
    fannedOut,
  };
}
