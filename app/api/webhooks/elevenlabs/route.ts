import crypto from "node:crypto";
import { serviceClient } from "@/lib/integrations/supabase";

export const dynamic = "force-dynamic";

/**
 * ElevenLabs post-call webhook receiver — Phase 0 tracer version.
 * Invariants (CLAUDE.md): verify HMAC · ALWAYS return 200 (a 4xx streak trips
 * ElevenLabs' auto-disable and silently freezes every search) · append raw,
 * never interpret. Interpretation arrives in step 3.3.
 */

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
  const raw = await req.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";
  const signature = req.headers.get("elevenlabs-signature");

  if (!verifySignature(raw, signature, secret)) {
    // Log-and-drop: nothing persisted, but still 200 so a misconfigured
    // secret can never trip the provider's auto-disable.
    console.error("[webhook] signature rejected", {
      secretConfigured: secret !== "",
      signaturePresent: signature !== null,
    });
    return Response.json({ received: true });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error("[webhook] unparseable body after valid signature");
    return Response.json({ received: true });
  }

  const p = payload as {
    type?: string;
    data?: { conversation_id?: string };
  };
  const eventType = p.type ?? "unknown";
  const conversationId = p.data?.conversation_id ?? null;
  // Identical provider retry = identical body = same key → unique index makes it a no-op.
  const dedupeKey = crypto
    .createHash("sha256")
    .update(`${eventType}:${raw}`)
    .digest("hex");

  const { error } = await serviceClient().from("call_events").insert({
    event_type: eventType,
    conversation_id: conversationId,
    dedupe_key: dedupeKey,
    payload,
  });
  if (error && error.code !== "23505") {
    // 23505 = duplicate (expected on retries); anything else must be visible
    console.error("[webhook] event insert failed", error.message);
  }

  return Response.json({ received: true });
}
