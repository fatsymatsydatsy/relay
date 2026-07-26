import crypto from "node:crypto";
import { after } from "next/server";
import { serviceClient } from "@/lib/integrations/supabase";
import { recordCallEvent } from "@/lib/commands/record_call_event";
import { extractResult } from "@/lib/commands/extract_result";
import { dispatch } from "@/lib/commands/dispatch";

export const dynamic = "force-dynamic";

/**
 * ElevenLabs post-call webhook receiver.
 * Invariants (CLAUDE.md): verify HMAC · ALWAYS return 200 from EVERY path
 * (a 5xx streak trips ElevenLabs' auto-disable and silently freezes every
 * search) · persist the verified raw body BEFORE parsing (raw is evidence) ·
 * interpretation (record_call_event) runs post-200 via next/server after()
 * — Vercel doesn't guarantee post-response work otherwise.
 */

const MAX_BODY_BYTES = 1_000_000; // transcripts run 10–100KB; anything bigger is abuse

function ok() {
  return Response.json({ received: true });
}

function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const parts = new Map(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)] as const;
    }),
  );
  const t = parts.get("t");
  const v0 = parts.get("v0");
  if (!t || !v0) return false;

  // reject stale/replayed events (30-minute tolerance)
  const ageMs = Math.abs(Date.now() - Number(t) * 1000);
  if (!Number.isFinite(ageMs) || ageMs > 30 * 60 * 1000) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  const given = v0.startsWith("v0=") ? v0.slice(3) : v0;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    // cap before buffering; Content-Length can lie, so re-check after read
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      console.error("[webhook] body over cap (declared)", { declared });
      return ok();
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      console.error("[webhook] body over cap (actual)", { length: raw.length });
      return ok();
    }

    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";
    const signature = req.headers.get("elevenlabs-signature");
    if (!verifySignature(raw, signature, secret)) {
      // Log-and-drop: nothing persisted, but still 200 so a misconfigured
      // secret can never trip the provider's auto-disable.
      console.error("[webhook] signature rejected", {
        secretConfigured: secret !== "",
        signaturePresent: signature !== null,
      });
      return ok();
    }

    // Verified — persist the raw body no matter what parsing says.
    let payload: Record<string, unknown> = {};
    let eventType = "unparseable";
    let conversationId: string | null = null;
    try {
      const p = JSON.parse(raw) as {
        type?: string;
        data?: { conversation_id?: string };
      } | null;
      if (p && typeof p === "object") {
        payload = p as Record<string, unknown>;
        eventType = p.type ?? "unknown";
        conversationId = p.data?.conversation_id ?? null;
      }
    } catch {
      // eventType stays "unparseable"; raw_body below is the evidence
    }

    // Identical provider retry = identical body = same key → unique index no-op.
    const dedupeKey = crypto
      .createHash("sha256")
      .update(`${eventType}:${raw}`)
      .digest("hex");

    const { error } = await serviceClient().from("call_events").insert({
      event_type: eventType,
      conversation_id: conversationId,
      dedupe_key: dedupeKey,
      payload,
      raw_body: raw,
    });
    if (error && error.code !== "23505") {
      // 23505 = duplicate (expected on retries); anything else must be visible
      console.error("[webhook] event insert failed", error.message);
    }

    // First delivery only (duplicates already returned above as 23505):
    // interpret AFTER the 200 is on the wire.
    if (!error) {
      after(async () => {
        try {
          await recordCallEvent(
            { eventType, payload },
            {
              extractFn: (callId) => extractResult(callId),
              dispatchFn: () => dispatch(),
            },
          );
        } catch (err) {
          console.error("[webhook] record_call_event failed", err);
        }
      });
    }

    return ok();
  } catch (err) {
    // The final backstop: no path may escape as a 5xx.
    console.error("[webhook] unexpected failure", err);
    return ok();
  }
}
