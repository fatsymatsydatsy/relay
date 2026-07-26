/**
 * ElevenLabs outbound calling (verified endpoint shapes — docs/architecture.md
 * §ElevenLabs + the 0.4 tracer). One function, injectable for tests.
 */

export interface OutboundCallInput {
  toNumber: string;
  dynamicVariables: Record<string, string>;
}

export type OutboundCallResult =
  | { ok: true; conversationId: string; callSid: string | null }
  /** definite=true → the provider REFUSED (frees the number/slot);
   *  definite=false → ambiguous (timeout/5xx) — the call may exist, leave the
   *  row dialing for the watchdog to reconcile. */
  | { ok: false; definite: boolean; detail: string };

export type OutboundCaller = (input: OutboundCallInput) => Promise<OutboundCallResult>;

export const elevenLabsOutboundCall: OutboundCaller = async (input) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !phoneNumberId) {
    return { ok: false, definite: true, detail: "elevenlabs env not configured" };
  }

  try {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: phoneNumberId,
          to_number: input.toNumber,
          conversation_initiation_client_data: {
            dynamic_variables: input.dynamicVariables,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 4xx = the provider understood and refused (over-cap, bad number…):
      // definite. 5xx = unknown state: ambiguous.
      return {
        ok: false,
        definite: res.status >= 400 && res.status < 500,
        detail: `${res.status} ${body.slice(0, 300)}`,
      };
    }

    const data = (await res.json()) as {
      conversation_id?: string;
      callSid?: string | null;
    };
    if (!data.conversation_id) {
      return { ok: false, definite: false, detail: "no conversation_id in response" };
    }
    return {
      ok: true,
      conversationId: data.conversation_id,
      callSid: data.callSid ?? null,
    };
  } catch (err) {
    // network failure/timeout — the call MAY have been placed: ambiguous
    return { ok: false, definite: false, detail: String(err).slice(0, 300) };
  }
};
