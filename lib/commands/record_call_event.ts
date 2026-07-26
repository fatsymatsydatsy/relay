import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/integrations/supabase";

/**
 * record_call_event (3.3) — interprets a verified, persisted webhook event.
 *
 * Runs AFTER the 200 (the route schedules it via next/server after()); the
 * raw event already sits append-only in call_events. Idempotency has two
 * layers: the route's dedupe_key unique index drops identical retries before
 * this runs, and every transition here is `UPDATE … WHERE status = expected`,
 * so replays and races collapse to no-ops (webhook.idempotent).
 *
 * Transitions (state machine v3):
 *   dialing → transcript_ready  (post_call_transcription; transcript stored)
 *   dialing → unreached          (call_initiation_failure; bucket 4)
 * Dead call → the bench promotes ONE replacement, then dispatch fills lines.
 * Drained search (nothing in flight, no non-bench queued) → leftover bench
 * rows expire + the search completes.
 */

export interface RecordCallEventInput {
  eventType: string;
  payload: Record<string, unknown>;
}

export interface RecordDeps {
  db?: SupabaseClient;
  /** invoked after a transcript lands (3.4's extract_result). */
  extractFn?: (callId: string) => Promise<void>;
  /** invoked whenever a line frees (3.2's dispatch). */
  dispatchFn?: () => Promise<unknown>;
  now?: Date;
}

export interface RecordResult {
  action:
    | "transcript_ready"
    | "unreached"
    | "duplicate_noop"
    | "orphan"
    | "ignored";
  callId?: string;
}

interface WebhookData {
  conversation_id?: string;
  transcript?: unknown;
  analysis?: unknown;
  conversation_initiation_client_data?: {
    dynamic_variables?: Record<string, unknown>;
  };
}

export async function recordCallEvent(
  input: RecordCallEventInput,
  deps: RecordDeps = {},
): Promise<RecordResult> {
  const db = deps.db ?? serviceClient();
  const now = deps.now ?? new Date();

  if (
    input.eventType !== "post_call_transcription" &&
    input.eventType !== "call_initiation_failure"
  ) {
    return { action: "ignored" };
  }

  const data = (input.payload.data ?? {}) as WebhookData;
  const callRef =
    data.conversation_initiation_client_data?.dynamic_variables?.call_ref;
  const conversationId = data.conversation_id ?? null;

  // correlate by OUR id first (0.4 designed-out bug: webhooks can outrun the
  // conversation_id save), provider id second
  let call: { id: string; search_id: string; status: string } | null = null;
  if (typeof callRef === "string" && callRef.length > 0) {
    const { data: byRef } = await db
      .from("calls")
      .select("id, search_id, status")
      .eq("id", callRef)
      .maybeSingle();
    call = byRef;
  }
  if (!call && conversationId) {
    const { data: byConv } = await db
      .from("calls")
      .select("id, search_id, status")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    call = byConv;
  }
  if (!call) {
    await db.from("anomalies").insert({
      kind: "webhook_orphan",
      detail: { eventType: input.eventType, callRef: callRef ?? null, conversationId },
    });
    return { action: "orphan" };
  }

  if (input.eventType === "post_call_transcription") {
    const { data: updated } = await db
      .from("calls")
      .update({
        status: "transcript_ready",
        transcript: {
          transcript: data.transcript ?? null,
          analysis: data.analysis ?? null,
        },
        ended_at: now.toISOString(),
      })
      .eq("id", call.id)
      .eq("status", "dialing") // legal transition only; replays no-op
      .select("id");
    if (!updated?.length) return { action: "duplicate_noop", callId: call.id };

    // a line just freed; extraction and refills run independently
    await Promise.allSettled([
      deps.extractFn ? deps.extractFn(call.id) : Promise.resolve(),
      deps.dispatchFn ? deps.dispatchFn() : Promise.resolve(),
    ]);
    await settleIfDrained(db, call.search_id, now);
    return { action: "transcript_ready", callId: call.id };
  }

  // call_initiation_failure: busy / no answer / unknown — terminal, bucket 4
  const { data: updated } = await db
    .from("calls")
    .update({ status: "unreached", rank_bucket: 4, ended_at: now.toISOString() })
    .eq("id", call.id)
    .eq("status", "dialing")
    .select("id");
  if (!updated?.length) return { action: "duplicate_noop", callId: call.id };

  await promoteBench(db, call.search_id);
  if (deps.dispatchFn) await deps.dispatchFn();
  await settleIfDrained(db, call.search_id, now);
  return { action: "unreached", callId: call.id };
}

/** One dead call → one bench replacement (best-ranked bench row steps up). */
async function promoteBench(db: SupabaseClient, searchId: string): Promise<void> {
  const { data: next } = await db
    .from("calls")
    .select("id")
    .eq("search_id", searchId)
    .eq("status", "queued")
    .eq("is_bench", true)
    .order("rank_score", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!next) return;
  await db
    .from("calls")
    .update({ is_bench: false })
    .eq("id", next.id)
    .eq("status", "queued");
}

/**
 * Drain settle: nothing in flight and nothing (non-bench) left to dial →
 * expire leftover bench rows and complete the search. The 20-minute deadline
 * path belongs to settle_search (4.1).
 */
export async function settleIfDrained(
  db: SupabaseClient,
  searchId: string,
  now: Date,
): Promise<boolean> {
  const { data: open } = await db
    .from("calls")
    .select("id, status, is_bench")
    .eq("search_id", searchId)
    .in("status", ["queued", "dialing", "transcript_ready"]);
  const inFlight = (open ?? []).filter((c) => c.status !== "queued");
  const dialable = (open ?? []).filter(
    (c) => c.status === "queued" && !c.is_bench,
  );
  if (inFlight.length > 0 || dialable.length > 0) return false;

  const leftoverBench = (open ?? []).map((c) => c.id);
  if (leftoverBench.length) {
    await db
      .from("calls")
      .update({ status: "expired", rank_bucket: 4 })
      .in("id", leftoverBench)
      .eq("status", "queued");
  }
  await db
    .from("searches")
    .update({ status: "complete", settled_at: now.toISOString() })
    .eq("id", searchId)
    .eq("status", "active");
  return true;
}
