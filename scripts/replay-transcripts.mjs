#!/usr/bin/env node
/**
 * Replay stored transcripts through the REAL extractor (3.4 evidence tool).
 *
 * Dry-run by default: prints transcript → verdict pairs for Marvin's 🧑 gate
 * ("read 5 pairs and agree") without touching any row. Uses the cloud project
 * + OpenAI key from .env.local.
 *
 * Usage: node scripts/replay-transcripts.mjs [limit]
 *
 * NOTE: prompt + schema are a synced copy of lib/prompts/extraction.ts
 * (this hand-run script can't import TypeScript). If extraction changes,
 * update both.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = (n) =>
  process.env[n] ??
  readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${n}=`))
    ?.slice(n.length + 1)
    .trim();

const limit = Number(process.argv[2] ?? 5);
const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const SYSTEM = `You extract a structured stock verdict from the transcript of ONE phone call an AI assistant made to a UK pharmacy on behalf of a patient.

Rules — these mirror hard database constraints, so violations are rejected:
- stock_status may be "in_stock" or "out_of_stock" ONLY when the call completed AND the pharmacy branch was confirmed (location_confirmed = "yes"). Anything else: "unclear" or "not_asked".
- outcome "voicemail", "wrong_location", "national_line": stock fields must be empty (stock_status "not_asked", quantities null, orderable "unknown", eta null).
- Voicemail, answering machines, IVR dead-ends with no human: outcome "voicemail".
- The person says it's a different branch or can't confirm the branch: outcome "wrong_location".
- A human answered, branch confirmed, but they refused, were too busy, or the call ended without a stock answer: outcome "refused" (explicit refusal) or "incomplete".
- ANY amount in stock is in_stock — one box counts. quantity_meets_need is informational only.
- Verbatim fields stay exactly as spoken ("two boxes", "Thursday-ish"). Do NOT normalize numbers or dates.
- Never invent. If the transcript doesn't say it, use "unclear"/"unknown"/null.
- notable_quotes: at most 2 short verbatim quotes that justify the verdict.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    call_ref: { type: "string" },
    outcome: { type: "string", enum: ["completed", "voicemail", "wrong_location", "national_line", "refused", "incomplete"] },
    location_confirmed: { type: "string", enum: ["yes", "no", "unclear"] },
    stock_status: { type: "string", enum: ["in_stock", "out_of_stock", "unclear", "not_asked"] },
    quantity_available_verbatim: { type: ["string", "null"] },
    quantity_meets_need: { type: "string", enum: ["yes", "no", "unknown"] },
    orderable: { type: "string", enum: ["yes", "no", "unknown"] },
    eta_verbatim: { type: ["string", "null"] },
    shortage_mentioned: { type: "boolean" },
    notable_quotes: { type: "array", items: { type: "string" }, maxItems: 2 },
  },
  required: ["call_ref", "outcome", "location_confirmed", "stock_status", "quantity_available_verbatim", "quantity_meets_need", "orderable", "eta_verbatim", "shortage_mentioned", "notable_quotes"],
};

const { data: calls, error } = await db
  .from("calls")
  .select("id, pharmacy_ods, transcript, status, created_at")
  .not("transcript", "is", null)
  .order("created_at", { ascending: false })
  .limit(limit);
if (error) throw new Error(error.message);
if (!calls?.length) {
  console.log("no transcript-bearing calls found");
  process.exit(0);
}

const apiKey = env("OPENAI_API_KEY");
if (!apiKey) throw new Error("OPENAI_API_KEY missing");

for (const call of calls) {
  console.log("\n" + "=".repeat(70));
  console.log(`call ${call.id} · ${call.pharmacy_ods} · status=${call.status}`);
  console.log("-".repeat(70));
  const turns = call.transcript?.transcript ?? call.transcript;
  console.log("TRANSCRIPT:", JSON.stringify(turns, null, 1).slice(0, 1500));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Call context:\n- call_ref (echo this exactly): ${call.id}\n\nTranscript (JSON turns, agent = our assistant):\n${JSON.stringify(turns, null, 2)}\n\nReturn the extraction JSON.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "pharmacy_call_extraction", strict: true, schema: SCHEMA },
      },
    }),
  });
  if (!res.ok) {
    console.log("OPENAI ERROR:", res.status, (await res.text()).slice(0, 200));
    continue;
  }
  const data = await res.json();
  console.log("VERDICT:", data.choices?.[0]?.message?.content);
}
console.log("\n(dry run — nothing written; rows unchanged)");

