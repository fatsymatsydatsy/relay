// 0.4.3/0.4.5 — the tracer bullet: one real outbound call, zero product logic.
// Usage: node scripts/tracer-call.mjs [+44...]   (defaults to first DEV_TEST number)
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);

const to = process.argv[2] ?? env.DEV_TEST_PHONE_NUMBERS.split(",")[0];
const callRef = crypto.randomUUID();

const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
  method: "POST",
  headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
  body: JSON.stringify({
    agent_id: env.ELEVENLABS_AGENT_ID,
    agent_phone_number_id: env.ELEVENLABS_PHONE_NUMBER_ID,
    to_number: to,
    conversation_initiation_client_data: {
      dynamic_variables: {
        call_ref: callRef,
        pharmacy_name: "Test Pharmacy A",
        street: "High Street",
        medication: "Creon 25,000 gastro-resistant capsules",
        quantity_needed: "2 boxes",
      },
    },
  }),
});

const body = await res.json();
console.log(JSON.stringify({ http: res.status, call_ref: callRef, ...body }, null, 2));
if (!res.ok || !body.conversation_id) process.exit(1);
console.log("TRACER_DIALED_OK");
