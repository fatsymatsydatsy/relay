import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/integrations/supabase";
import {
  elevenLabsOutboundCall,
  type OutboundCaller,
} from "@/lib/integrations/elevenlabs";
import { resolveDialNumber, type DialMode } from "@/lib/domain/dial-resolution";

/**
 * dispatch (3.2) — fills free lines. Triggered on: search created · any call
 * terminal · watchdog tick. The database function claim_next_dials owns EVERY
 * invariant (advisory-locked; see its migration); this command only resolves
 * the number (DEV_TEST reroute), POSTs to ElevenLabs, and records the result:
 *   accepted        → conversation_id + dial_log 'connected'
 *   definite reject → row back to 'queued' + dial_log 'freed' (recoverable)
 *   ambiguous       → row STAYS 'dialing' — the watchdog reconciles; freeing
 *                     an unknown-state call could double-dial the pharmacy.
 * Kill switch: DIALING_ENABLED=false → the claim is never even attempted.
 */

export interface DispatchDeps {
  db?: SupabaseClient;
  caller?: OutboundCaller;
  now?: Date;
  globalCap?: number;
  dialMode?: DialMode;
  devTestNumbers?: string[];
  dialingEnabled?: boolean;
}

export interface DispatchResult {
  claimed: number;
  posted: number;
  freed: number;
  ambiguous: number;
}

interface ClaimedRow {
  call_id: string;
  search_id: string;
  pharmacy_ods: string;
  pharmacy_name: string;
  pharmacy_address: string;
  pharmacy_phone: string;
  pharmacy_verified: boolean;
  pharmacy_source: string;
  medication_display: string;
  quantity_needed: number;
}

/** ≤8 in flight globally is an invariant, not a config suggestion (audit
 *  P1-6): a bad GLOBAL_CAP can only lower the cap. The claim function clamps
 *  again DB-side — two independent layers. */
function clampCap(value: number, ceiling: number): number {
  if (!Number.isFinite(value)) return ceiling;
  return Math.max(0, Math.min(Math.floor(value), ceiling));
}

export async function dispatch(deps: DispatchDeps = {}): Promise<DispatchResult> {
  const db = deps.db ?? serviceClient();
  const caller = deps.caller ?? elevenLabsOutboundCall;
  const now = deps.now ?? new Date();
  const globalCap = clampCap(deps.globalCap ?? Number(process.env.GLOBAL_CAP ?? 8), 8);
  const dialMode = deps.dialMode ?? ((process.env.DIAL_MODE ?? "DEV_TEST") as DialMode);
  const devTestNumbers =
    deps.devTestNumbers ??
    (process.env.DEV_TEST_PHONE_NUMBERS ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  const dialingEnabled =
    deps.dialingEnabled ?? process.env.DIALING_ENABLED !== "false";

  const result: DispatchResult = { claimed: 0, posted: 0, freed: 0, ambiguous: 0 };
  if (!dialingEnabled) return result;

  // Two passes at most: definite rejections free their rows back to queued,
  // and with no call in flight there is no webhook to wake dispatch again
  // (audit P2-1) — so ONE bounded re-claim follows a freeing pass. Never a
  // hot loop: a second all-rejected pass ends the command.
  for (let pass = 0; pass < 2; pass++) {
    const { data: rows, error } = await db.rpc("claim_next_dials", {
      p_global_cap: globalCap,
      p_dial_mode: dialMode,
      p_at: now.toISOString(),
    });
    if (error) throw new Error(`claim_next_dials: ${error.message}`);
    const claimed = (rows ?? []) as ClaimedRow[];
    result.claimed += claimed.length;
    let freedThisPass = 0;

    for (const row of claimed) {
      const resolution = resolveDialNumber(
        {
          ods: row.pharmacy_ods,
          phone: row.pharmacy_phone,
          verified: row.pharmacy_verified,
          source: row.pharmacy_source,
        },
        dialMode,
        devTestNumbers,
      );

      if (!resolution.ok) {
        // config problem (e.g. no dev numbers) — free the claim, log loudly
        await free(db, row.call_id);
        await db.from("anomalies").insert({
          kind: "dial_resolution_refused",
          detail: { call_id: row.call_id, reason: resolution.reason, mode: dialMode },
        });
        result.freed++;
        continue; // config failures repeat identically — no re-pass for these
      }

      await db
        .from("calls")
        .update({ resolved_number: resolution.resolvedNumber })
        .eq("id", row.call_id);

      const outcome = await caller({
        toNumber: resolution.resolvedNumber,
        dynamicVariables: {
          call_ref: row.call_id,
          pharmacy_name: row.pharmacy_name,
          street: row.pharmacy_address,
          medication: row.medication_display,
          quantity_needed: String(row.quantity_needed),
        },
      });

      if (outcome.ok) {
        await db
          .from("calls")
          .update({ conversation_id: outcome.conversationId, call_sid: outcome.callSid })
          .eq("id", row.call_id);
        await db
          .from("dial_log")
          .update({ outcome: "connected" })
          .eq("call_id", row.call_id)
          .eq("outcome", "reserved");
        result.posted++;
      } else if (outcome.definite) {
        await free(db, row.call_id);
        result.freed++;
        freedThisPass++;
      } else {
        // ambiguous: the call may be live — watchdog reconciles via the
        // provider API; the number stays politely blocked meanwhile
        await db.from("anomalies").insert({
          kind: "dial_post_ambiguous",
          detail: { call_id: row.call_id, detail: outcome.detail },
        });
        result.ambiguous++;
      }
    }

    if (freedThisPass === 0) break;
  }

  return result;
}

/** Definite non-call: the row goes back in the queue, the number unblocks. */
async function free(db: SupabaseClient, callId: string): Promise<void> {
  await db
    .from("calls")
    .update({
      status: "queued",
      claimed_at: null,
      dial_mode: null,
      intended_number: null,
      resolved_number: null,
    })
    .eq("id", callId)
    .eq("status", "dialing");
  await db
    .from("dial_log")
    .update({ outcome: "freed" })
    .eq("call_id", callId)
    .eq("outcome", "reserved");
}
