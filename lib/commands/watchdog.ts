import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/integrations/supabase";
import {
  elevenLabsGetConversation,
  type ConversationLookup,
} from "@/lib/integrations/elevenlabs";
import { recordCallEvent } from "@/lib/commands/record_call_event";
import { settleIfDrained, promoteBench } from "@/lib/commands/record_call_event";

/**
 * watchdog (4.2) — the safety net for everything the event flow can drop.
 * Invoked every 60s by pg_cron → pg_net → POST /api/internal/watchdog
 * (scripts/setup-watchdog.sql), and directly by tests.
 *
 * Three rules, all fail-safe (only DEFINITE provider answers transition
 * rows; anything ambiguous is logged and left alone — freeing an
 * unknown-state call could double-dial a pharmacy):
 *
 *  1. STALE IN-FLIGHT — `dialing` older than `staleAfterSeconds`:
 *     · provider says done   → interpret as the lost post_call_transcription
 *       (recordCallEvent: same guarded transitions, extract, refill, settle)
 *     · provider says failed → interpret as the lost call_initiation_failure
 *     · provider has NO record (404) → `unreached` + bench promotion
 *       (state machine: "dialing → unreached: watchdog reconcile")
 *     · in progress / lookup error → anomaly only
 *     · no conversation_id at all (ambiguous POST): anomaly; after
 *       `abandonAfterSeconds` → `unreached` + bench promotion
 *  2. STUCK EXTRACTION — `transcript_ready` older than
 *     `extractAfterSeconds` → re-run extract_result (idempotent; exhaustion
 *     is honest bucket 4 + promotion)
 *  3. DEAD-QUIET SEARCHES — deadline sweep (4.1) + drain-settle any active
 *     search whose children are all terminal (crash between a terminal
 *     transition and its settle)
 *
 * Every ACTION writes an anomaly row — the log existing = look at it.
 */

export interface WatchdogDeps {
  db?: SupabaseClient;
  now?: Date;
  conversations?: ConversationLookup;
  extractFn?: (callId: string) => Promise<unknown>;
  dispatchFn?: () => Promise<unknown>;
  staleAfterSeconds?: number;
  extractAfterSeconds?: number;
  abandonAfterSeconds?: number;
}

export interface WatchdogSummary {
  reconciledDone: number;
  reconciledFailed: number;
  reconciledGone: number;
  ambiguous: number;
  reExtracted: number;
  expiredCalls: number;
  settledSearches: number;
}

export async function watchdog(deps: WatchdogDeps = {}): Promise<WatchdogSummary> {
  const db = deps.db ?? serviceClient();
  const now = deps.now ?? new Date();
  const conversations = deps.conversations ?? elevenLabsGetConversation;
  const staleAfter = deps.staleAfterSeconds ?? 120;
  const extractAfter = deps.extractAfterSeconds ?? 90;
  const abandonAfter = deps.abandonAfterSeconds ?? 600;

  const summary: WatchdogSummary = {
    reconciledDone: 0,
    reconciledFailed: 0,
    reconciledGone: 0,
    ambiguous: 0,
    reExtracted: 0,
    expiredCalls: 0,
    settledSearches: 0,
  };
  const anomaly = (kind: string, detail: Record<string, unknown>) =>
    db.from("anomalies").insert({ kind, detail });

  // ── rule 1: stale in-flight ────────────────────────────────────────────────
  const staleBefore = new Date(now.getTime() - staleAfter * 1000).toISOString();
  const { data: stale } = await db
    .from("calls")
    .select("id, search_id, conversation_id, claimed_at")
    .eq("status", "dialing")
    .lte("claimed_at", staleBefore);

  for (const call of stale ?? []) {
    if (!call.conversation_id) {
      // the POST outcome was ambiguous and no webhook ever named this call
      const age = (now.getTime() - new Date(call.claimed_at).getTime()) / 1000;
      if (age >= abandonAfter) {
        const { data: updated } = await db
          .from("calls")
          .update({ status: "unreached", rank_bucket: 4, ended_at: now.toISOString() })
          .eq("id", call.id)
          .eq("status", "dialing")
          .select("id");
        if (updated?.length) {
          await anomaly("watchdog_abandoned_no_conversation", { call_id: call.id, age });
          await promoteBench(db, call.search_id);
          if (deps.dispatchFn) await deps.dispatchFn();
          await settleIfDrained(db, call.search_id, now);
          summary.reconciledGone++;
        }
      } else {
        await anomaly("watchdog_stale_no_conversation", { call_id: call.id, age });
        summary.ambiguous++;
      }
      continue;
    }

    const lookup = await conversations(call.conversation_id);
    if (lookup.ok && lookup.state === "in_progress") continue; // genuinely live

    if (lookup.ok && (lookup.state === "done" || lookup.state === "failed")) {
      // replay the webhook we never received through the SAME machinery
      const synthesized =
        lookup.state === "done"
          ? {
              eventType: "post_call_transcription",
              payload: {
                type: "post_call_transcription",
                data: {
                  conversation_id: call.conversation_id,
                  transcript: lookup.transcript,
                  analysis: lookup.analysis,
                  conversation_initiation_client_data: {
                    dynamic_variables: { call_ref: call.id },
                  },
                },
              },
            }
          : {
              eventType: "call_initiation_failure",
              payload: {
                type: "call_initiation_failure",
                data: {
                  conversation_id: call.conversation_id,
                  conversation_initiation_client_data: {
                    dynamic_variables: { call_ref: call.id },
                  },
                },
              },
            };
      const result = await recordCallEvent(synthesized, {
        db,
        extractFn: deps.extractFn,
        dispatchFn: deps.dispatchFn,
        now,
      });
      await anomaly(`watchdog_reconciled_${lookup.state}`, {
        call_id: call.id,
        conversation_id: call.conversation_id,
        action: result.action,
      });
      if (lookup.state === "done") summary.reconciledDone++;
      else summary.reconciledFailed++;
      continue;
    }

    if (!lookup.ok && lookup.notFound) {
      // no provider record — the call does not exist; the number stays
      // politely blocked (we can't prove it never rang)
      const { data: updated } = await db
        .from("calls")
        .update({ status: "unreached", rank_bucket: 4, ended_at: now.toISOString() })
        .eq("id", call.id)
        .eq("status", "dialing")
        .select("id");
      if (updated?.length) {
        await anomaly("watchdog_reconciled_gone", {
          call_id: call.id,
          conversation_id: call.conversation_id,
        });
        await promoteBench(db, call.search_id);
        if (deps.dispatchFn) await deps.dispatchFn();
        await settleIfDrained(db, call.search_id, now);
        summary.reconciledGone++;
      }
      continue;
    }

    // lookup error — unknown state, touch nothing
    await anomaly("watchdog_reconcile_ambiguous", {
      call_id: call.id,
      conversation_id: call.conversation_id,
      detail: !lookup.ok && !lookup.notFound ? lookup.detail : "unknown",
    });
    summary.ambiguous++;
  }

  // ── rule 2: stuck extraction ──────────────────────────────────────────────
  const extractBefore = new Date(now.getTime() - extractAfter * 1000).toISOString();
  const { data: stuck } = await db
    .from("calls")
    .select("id")
    .eq("status", "transcript_ready")
    .lte("ended_at", extractBefore);
  for (const call of stuck ?? []) {
    await anomaly("watchdog_reextract", { call_id: call.id });
    if (deps.extractFn) await deps.extractFn(call.id);
    summary.reExtracted++;
  }

  // ── rule 3: dead-quiet searches ───────────────────────────────────────────
  const { data: sweep, error: sweepError } = await db.rpc("settle_expired_searches", {
    p_at: now.toISOString(),
  });
  if (sweepError) throw new Error(`settle_expired_searches: ${sweepError.message}`);
  const swept = (sweep ?? [])[0] as
    | { expired_calls: number; settled_searches: number }
    | undefined;
  summary.expiredCalls = swept?.expired_calls ?? 0;
  summary.settledSearches = swept?.settled_searches ?? 0;
  if (summary.expiredCalls || summary.settledSearches) {
    await anomaly("watchdog_deadline_sweep", { ...swept });
  }

  const { data: active } = await db.from("searches").select("id").eq("status", "active");
  for (const search of active ?? []) {
    const settled = await settleIfDrained(db, search.id, now);
    if (settled) {
      await anomaly("watchdog_drain_settled", { search_id: search.id });
      summary.settledSearches++;
    }
  }

  return summary;
}
