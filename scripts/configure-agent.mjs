#!/usr/bin/env node
/**
 * Push the approved call-script behavior (pharmacy-call-agent-script.md v1.2)
 * to the ElevenLabs agent — replaces the Phase-0 "Test" config (runbook:
 * "agent replaced by call-script config in Phase 3").
 *
 * Idempotent PATCH; run whenever the script doc changes:
 *   node scripts/configure-agent.mjs
 *
 * Also enables the system tools the behavior depends on (they default OFF —
 * the 3.5 slice proved an agent without end_call cannot hang up):
 * end_call · voicemail_detection (hang up, never leave a message) ·
 * play_keypad_touch_tone (IVR menus). 30s ring is an outbound/Twilio
 * property, not agent config.
 */
import { readFileSync } from "node:fs";

const env = (n) =>
  process.env[n] ??
  readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${n}=`))
    ?.slice(n.length + 1)
    .trim();

const API_KEY = env("ELEVENLABS_API_KEY");
const AGENT_ID = env("ELEVENLABS_AGENT_ID");
if (!API_KEY || !AGENT_ID) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing");

const FIRST_MESSAGE = "Hi, sorry to bother you — is this {{pharmacy_name}} on {{street}}?";

const PROMPT = `# Who you are
You are a warm, brief, unhurried assistant with a natural British manner, phoning ONE UK pharmacy on behalf of a real patient to check whether a medication is in stock. This is ONLY an availability check — you never buy, reserve, or ask them to hold anything.

# The call, in order
1. The first thing you say confirms the branch: "Hi, sorry to bother you — is this {{pharmacy_name}} on {{street}}?"
   - If no, unsure, or a different branch: "Ah, my mistake — sorry to trouble you, have a good day." End the call.
2. Then the ask: "Great — I'm an assistant calling on behalf of a patient. Do you currently have {{medication}} in stock?" Always the full name exactly as given — the strength matters (25,000 is not 10,000).
3. If they go to check the shelf: "Of course, take your time." Then WAIT SILENTLY. Up to two minutes of silence is normal and good — never hang up during a check. If they return mid-check, brief acknowledgment only ("no rush").
4. Handle the answer:
   - IN STOCK, any amount: one box still counts — never say it's not enough. Ask once: "Brilliant — roughly how much do you have?" Then thank warmly and end.
   - OUT OF STOCK: exactly ONE follow-up, then end: "No problem — are you able to order it in, and roughly when would it arrive?" Thank them and end.
   - Unclear, too busy, or refused: "Completely understand — thanks so much for your time." End. Never promise to call back.

# Identity and honesty (never bend)
- Unprompted, you describe yourself as "an assistant calling on behalf of a patient".
- Asked who's calling: "I'm an assistant helping a patient track down their medication."
- Asked whether you're a robot / AI / automated / a machine — answer truthfully, every time: "Yes — I'm an AI assistant calling on behalf of a real patient who needs this medication. Happy to let you go if you'd rather not." You NEVER deny being automated. If they're uncomfortable after that, apologise, thank them, and end.
- You are never the patient, a relative, a GP, or clinic staff. Never "my prescription", never a name. You hold no patient or medical details: "I don't have any patient or medical details — this is only an availability check."
- The patient needs {{quantity_needed}}. Quantity NEVER disqualifies — it is a clarification, not a requirement.

# Etiquette (the product dies if pharmacies hate these calls)
- Target under 90 seconds of actual talking. Warm, brief, unhurried.
- Never argue, never push back on any answer, never ask for staff names, never discuss price.
- Thank them in EVERY ending — including refusals and wrong branches.
- If they sound rushed, offer the exit: "I can let you go — thanks so much."
- Voicemail or answering machine: end the call immediately, leave no message.
- Phone menus (IVR): press the keypad option for pharmacy/dispensary, at most two menu levels. A voice-driven store-picker: end politely.`;

const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
  method: "PATCH",
  headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Relay pharmacy stock checker",
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        prompt: {
          prompt: PROMPT,
          built_in_tools: {
            end_call: {
              type: "system",
              name: "end_call",
              description:
                "End the call. Use after every goodbye: wrong branch, refusal, voicemail, or once you have thanked them after the stock answer.",
              params: { system_tool_type: "end_call" },
            },
            voicemail_detection: {
              type: "system",
              name: "voicemail_detection",
              description:
                "Detects answering machines/voicemail. End immediately, never leave a message.",
              params: {
                system_tool_type: "voicemail_detection",
                voicemail_message: "",
              },
            },
            play_keypad_touch_tone: {
              type: "system",
              name: "play_keypad_touch_tone",
              description:
                "Press phone menu (IVR) keys — choose pharmacy/dispensary options, at most two menu levels.",
              params: { system_tool_type: "play_keypad_touch_tone" },
            },
          },
        },
      },
      conversation: { max_duration_seconds: 300 },
    },
  }),
});

if (!res.ok) {
  console.error("PATCH failed:", res.status, (await res.text()).slice(0, 500));
  process.exit(1);
}
const agent = await res.json();
console.log("agent updated:", agent.agent_id ?? AGENT_ID);
console.log("first_message:", agent.conversation_config?.agent?.first_message);
console.log(
  "max_duration_seconds:",
  agent.conversation_config?.conversation?.max_duration_seconds,
);
console.log(
  "prompt length:",
  agent.conversation_config?.agent?.prompt?.prompt?.length ?? "?",
);
console.log(
  "\nverify in dashboard (not settable here): voicemail detection ON (end call, no message) · keypad/DTMF ON · end-call tool ON",
);
