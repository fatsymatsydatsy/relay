# Relay fold-in adversarial review — 2026-07-26

Baseline: uncommitted Phase 1.2 working tree against `HEAD` (`7bb4ad2`). Review method: `curl` against the supplied Next.js dev server plus static analysis. I did not start, stop, or restart the server; install packages; deploy; or modify any file other than this report.

Severity:

- **P1** — block a public/judged demo or production deployment.
- **P2** — material correctness, privacy, accessibility, honesty, or operational risk.
- **P3** — lower-risk hardening, auditability, or maintainability issue.

The explicitly excluded planned gap was not counted: the current `CallPhase`/result seam does not yet model orderable, couldn't-reach, expired, wrong-branch, quantity, or timestamps.

## Executive result

**HTTP/SSR acceptance passed, but the merge is not safe to present as a real product yet.** The biggest issue is that `/search` is a deterministic simulator which ignores the request while the UI says calls and stock results are live, then presents actionable prescription guidance and a fake successful phone connection. Privacy also blocks sign-off: exact medication/dose go to PostHog, and a full postcode plus postcode-derived map location go to third parties before F4 has been approved.

Finding counts: **P1 4 · P2 11 · P3 5**.

## Verified checks

| Check | Result | Evidence |
|---|---|---|
| `/` HTTP | **PASS** | `GET http://localhost:65261/` returned 200, `text/html`, 72,940 bytes. |
| `/` SSR hero | **PASS** | SSR contains the H1 beginning “Stop calling 30 pharmacies.” (`components/Hero.tsx:49`). |
| `/` SSR waitlist | **PASS** | SSR contains two labelled email forms and submit buttons (`components/WaitlistForm.tsx:117-152`). |
| `/` footer disclaimer | **PASS for content** | SSR contains “999” and “NHS 111” together with the stock-checker/no-medical-advice copy (`components/Footer.tsx:9-13`). See P2-2 for visibility. |
| `/search` HTTP | **PASS** | `GET http://localhost:65261/search` returned 200, `text/html`, 30,195 bytes. |
| `/search` SSR shell | **PASS** | SSR contains medication, dose, and postcode fields (`components/search/SearchForm.tsx:53-126`). |
| Internal links/assets | **PASS** | `/search`, `/icon.svg`, `/__forms.html`, and landing fragment targets `#join`, `#how-it-works`, `#shortages`, and `#top` resolve/present. No broken in-scope link was found. |
| TypeScript | **PASS** | `tsc --noEmit --incremental false` exited 0 against the current tree. |
| Dependency tree | **PASS** | `npm ls --depth=0` exited cleanly. Lockfile peers align: Next 16.2.12 accepts React 19; react-leaflet 5.0.0 and `@react-leaflet/core` 3.0.0 accept React/React DOM 19 and Leaflet 1.9.4. |
| Tailwind/PostCSS | **PASS for current dev compilation** | Tailwind 3.4.17, PostCSS 8.5.6, and Autoprefixer 10.4.21 are in the lockfile; `postcss.config.mjs:1-9`, `tailwind.config.ts:3-102`, and `app/globals.css:1-3` are consistent, and both routes serve compiled styling. |
| `next.config.ts` | **No build blocker found** | It is a valid empty Next config (`next.config.ts:1-5`). See P1-4 for missing CSP defence-in-depth. |
| Raw transcript exposure | **PASS in inspected code/grants** | Client UI/types contain no transcript field. Client `calls` grant omits `transcript`, and `call_events` has no client grant (`supabase/migrations/20260726000001_init.sql:210-215`). |
| Current/prospective secret scan | **PASS** | `git ls-files` and all unignored prospective files were scanned for common AWS, OpenAI, GitHub, Slack, Supabase, JWT, private-key, token, and literal secret patterns; no candidates were found. |
| `.env.local` ignore | **PASS** | `git check-ignore` resolves `.env.local` to `.gitignore:17`; it is not tracked. |
| `.env.example` values | **PASS for secrets** | Secret fields are blank and the optional PostHog host is non-secret (`.env.example:1-28`). See P3-1 for the ignore-rule defect. |

## Findings

### P1

#### P1-1 — The deterministic simulator is presented as live stock and a real phone connection

**Evidence:** `/search` hard-wires `createSimulatedEngine()` (`app/search/page.tsx:50-53`). The engine ignores the request (`lib/search/simulated.ts:163-170`), returns fixed stock outcomes and fake phones (`lib/search/simulated.ts:40-110`), and changes `connecting` to `connected` after a timer only (`lib/search/simulated.ts:174-178`). The UI nevertheless says “Live pharmacy search” (`app/search/page.tsx:140-153`), “calling live” (`components/search/CallingBoard.tsx:60-65`), asserts a pharmacy “has [medication] in stock,” and tells the patient to change their nomination or provide an NHS number (`components/search/ResultCard.tsx:45-55,79-100`). ConnectFlow then says “You're connected” and “You're speaking in your own voice” (`components/search/ConnectFlow.tsx:21-37`).

**Impact:** Any arbitrary medication/postcode receives authoritative-looking stock and prescription instructions even though no pharmacy was called. This is a patient-safety and submission-integrity blocker, not merely the already-known missing result states.

**Concrete fix:** Gate the simulator behind an explicit demo-only flag; show a persistent **SIMULATED DEMO — no calls are being placed and results are fictional** label on every simulated stage; remove phone/NHS action instructions and the Connect CTA until backed by real verified state. Production should fail closed or route to the live engine, never silently use the simulator.

#### P1-2 — Exact medication and dose are sent to PostHog

**Evidence:** A configured PostHog client receives `medication` and `dose` on every search (`app/search/page.tsx:71-77`; `lib/analytics.ts:3-10`). PostHog is initialized globally without a consent gate (`components/PostHogProvider.tsx:12-21`). The manual pageview also forwards the complete query string (`components/PostHogProvider.tsx:24-34`).

**Impact:** Medication and dose are sensitive health-search data linked to a PostHog device identity. Omitting postcode from this one event does not make the event privacy-safe, and F4 remains unsigned.

**Concrete fix:** Keep `NEXT_PUBLIC_POSTHOG_KEY` unset until F4/privacy approval. If analytics is retained, send only a generic event such as `search_started`, never medication, dose, postcode, email, or arbitrary query parameters; use pathname only for pageviews and explicitly disable unapproved autocapture/session features.

#### P1-3 — Full postcode and postcode-derived location leave the browser for unapproved third parties

**Evidence:** The client map invokes geocoding for the entered postcode (`components/search/LeafletPharmacyMap.tsx:77-92`). `geocodePostcode` places the full postcode in a GET path to `api.postcodes.io` (`lib/search/geocode.ts:19-24,45-48`). The resulting location determines browser requests to OpenStreetMap tiles (`components/search/LeafletPharmacyMap.tsx:124-138`). This contradicts the nearby claim that postcode “only ever goes to our own backend” (`app/search/page.tsx:71-73`) and F4 is explicitly pending (`build-steps.md:83-89`).

**Impact:** A full residential postcode is disclosed with the user's network metadata to postcodes.io, while OSM receives IP plus tile-level location. That is outside the approved first-party data boundary for a medication search.

**Concrete fix:** Disable the real geocoded map until F4 is signed off. Prefer a server-owned/bundled postcode dataset or a deliberately coarse outward-code lookup behind the first-party backend with documented retention and disclosure. Do not make third-party tile requests centered on patient location without approval and notice.

#### P1-4 — User-controlled postcode is inserted into Leaflet `innerHTML`

**Evidence:** The form accepts any non-empty postcode string (`components/search/SearchForm.tsx:23,33-43,113-126`). `patientIcon()` interpolates `postcode.toUpperCase()` directly into `L.divIcon({ html: ... })` (`components/search/LeafletPharmacyMap.tsx:53-60`) and renders that icon (`components/search/LeafletPharmacyMap.tsx:138`). Uppercasing is not escaping.

**Impact:** Leaflet assigns DivIcon HTML through `innerHTML`, creating a DOM-injection/XSS sink on the application origin. The empty `next.config.ts` also supplies no application CSP as defence-in-depth.

**Concrete fix:** Never interpolate user text into icon HTML. Construct an element and assign the label with `textContent`, or use a React-rendered label; strictly parse and normalize a UK postcode before use. Add a restrictive CSP in production after removing the unsafe sink.

### P2

#### P2-1 — Invalid or unresolved postcodes silently become central London

**Evidence:** Validation checks only for non-empty text (`components/search/SearchForm.tsx:23,33-43`). Any lookup failure, including network failure, silently returns `DEFAULT_CENTER` in central London (`lib/search/geocode.ts:11-17,19-33`). The map then labels the result as pharmacies “near” the entered postcode (`components/search/LeafletPharmacyMap.tsx:114-122`).

**Impact:** Typos, invented postcodes, outages, and CORS failures produce confident but geographically false “nearby” results.

**Concrete fix:** Validate and normalize a UK postcode before starting. Model geocode failure explicitly, show a retry/correction message, and never substitute a different city while retaining the user's postcode label.

#### P2-2 — The hard-rule disclaimer is present but not “always visible”

**Evidence:** The only disclaimer is in the footer (`components/Footer.tsx:5-14`), rendered after the flex-growing form/calling/results workflow (`app/search/page.tsx:115-137,261-264`). It is not adjacent to the search form, calling board, result card, or prescription instructions.

**Impact:** On a typical mobile viewport, the user can act on stock/nomination guidance without seeing the stock-checker/no-medical-advice/999/111 safety copy required by `docs/runbook.md:38` and `CLAUDE.md:39`.

**Concrete fix:** Add a compact persistent disclaimer beside the form and in the calling/results container, retaining both 999 and NHS 111. Keep the full footer version as well.

#### P2-3 — The simulator visibly models five overlapping calls, violating the hard ≤3 cap

**Evidence:** The five scripts begin at 0, 450, 1000, 1550, and 2100 ms and all remain active together after 2100 ms (`lib/search/simulated.ts:40-110`). The landing animation has the same overlap (`lib/pharmacies.ts:19-24`). Copy claims “every nearby pharmacy at once” (`app/search/page.tsx:35-39`) and “5 calls” live (`components/RelayPanel.tsx:178-184`), conflicting with the invariant at `CLAUDE.md:34`.

**Impact:** The demo teaches and advertises behavior the production architecture forbids.

**Concrete fix:** Keep at most three rows in dialing/asking at once; leave later calls queued until a slot frees. Change copy to “selected nearby pharmacies in parallel” rather than “every ... at once.”

#### P2-4 — Vercel's Netlify fallback can store nothing while the UI confirms success

**Evidence:** Against the supplied Next server, `POST /__forms.html` returned **405**. `submitToNetlifyForms` turns non-OK/network failure into `false` (`lib/netlify.ts:18-32`), but the caller ignores that return value (`components/WaitlistForm.tsx:45-50`). If Supabase config is absent, it unconditionally displays success (`components/WaitlistForm.tsx:52-57`).

**Impact:** The failure is silent, but not harmless: on Vercel with missing/mis-scoped Supabase env, the user is told “You're on the list” although neither backend stored the email. The awaited best-effort POST can also delay the primary path.

**Concrete fix:** On Vercel, skip Netlify Forms entirely. Show success only after at least one persistence backend confirms success; otherwise show a retryable error. If multi-host fallback is kept, use an explicit host adapter and a short timeout rather than an ignored boolean.

#### P2-5 — The public waitlist insert/count path is trivial to spam

**Evidence:** The migration gives `anon` and `authenticated` unrestricted insert policy/grant (`supabase/migrations/20260726031500_waitlist_and_realtime.sql:16-24`), and exposes an aggregate count RPC (`supabase/migrations/20260726031500_waitlist_and_realtime.sql:26-37`). There is no server-side rate limit, bot check, email length/shape constraint, or abuse control.

**Impact:** Anyone with the public anon key can bypass the form, fill the table with arbitrary unique strings, and inflate the public count.

**Concrete fix:** Revoke direct anonymous table insert; submit through a rate-limited first-party command with normalized/validated email and a honeypot or challenge. Add a reasonable database length/shape constraint and rate/abuse monitoring.

#### P2-6 — A synthetic baseline is stated as real traction

**Evidence:** Every count includes a hard-coded 214 (`lib/waitlist.ts:3-5,19-25`). The UI states that this many “people already joined” (`components/Hero.tsx:66-71`; `components/BottomCTA.tsx:17-21`). F2 acknowledges it is not real traction (`build-steps.md:83-85`), while the runbook requires honest recruitment (`docs/runbook.md:3`).

**Impact:** Judges and users can reasonably interpret fabricated social proof as real signups.

**Concrete fix:** Display the real count only. If the baseline must remain for a visual demo, label it unambiguously as sample/demo data and do not show it in the judged production deployment.

#### P2-7 — The product promises SMS/background monitoring but collects no phone and implements neither

**Evidence:** Landing copy says results arrive by text and the user can be bridged live (`components/HowItWorks.tsx:23-30`; `components/RelayPanel.tsx:218-220`). The no-stock state promises Relay “will keep checking and text you” (`app/search/page.tsx:239-246`). `SearchRequest` contains only medication, dose, and postcode (`lib/search/types.ts:8-12`), and the simulated engine completes and stops (`lib/search/simulated.ts:163-171`).

**Impact:** These are impossible promises under the current privacy/data contract and implementation.

**Concrete fix:** Change the copy to “results appear on this page” and remove background/SMS/connect promises. Do not add phone PII without explicitly changing and approving the privacy contract.

#### P2-8 — The medication combobox has no programmatic label

**Evidence:** `SearchForm` creates `medLabelId`, places it on a `<label>`, but neither uses `htmlFor` nor passes it to the combobox (`components/search/SearchForm.tsx:48,53-69`). The actual input has no `aria-label` or `aria-labelledby` (`components/search/MedicationCombobox.tsx:80-100`).

**Impact:** Screen-reader users may encounter an unnamed combobox despite the visible “Medication” text.

**Concrete fix:** Pass a stable input ID and use `<label htmlFor>`, or pass `medLabelId` and set `aria-labelledby` on the combobox input.

#### P2-9 — Editing a selected medication can submit the previous drug's auto-filled dose

**Evidence:** Selecting a medication overwrites dose, but a null/unrecognized medication selection does not clear or revalidate it (`components/search/SearchForm.tsx:25-30`). Every text edit recomputes an exact medication or `null` (`components/search/MedicationCombobox.tsx:52-55`).

**Impact:** A user can select one medicine, edit the medicine to arbitrary text, and submit the old medicine's strength with the new name.

**Concrete fix:** Track whether the dose was auto-filled; clear it when the medication no longer matches, and require the user to choose/reconfirm a valid dose for the final medication.

#### P2-10 — Static medicine data is labelled “Live” and “happening right now”

**Evidence:** The “active” shortages and SSPs are a hard-coded array (`components/ActiveShortages.tsx:7-12`) presented as “Live in the UK” and “Shortages happening right now” (`components/ActiveShortages.tsx:33-43`). The combobox also hard-codes `shortage: true` (`lib/search/medications.ts:17-35`).

**Impact:** Stale medicine-status claims are high-risk health information even when the stock checker has a disclaimer.

**Concrete fix:** Either source the status from an authoritative feed with a visible source and “as of” timestamp, or relabel it as illustrative demo data and remove “Live,” “right now,” and “Active.”

#### P2-11 — The merge manufactures a green test gate with zero tests

**Evidence:** `vitest.config.ts:5-8` adds `passWithNoTests: true`, while `tests/` contains only `.gitkeep`. Phase 1.2 claims `test` as an acceptance gate (`build-steps.md:74`), and repo protocol requires machine-green before handoff (`CLAUDE.md:47`).

**Impact:** `npm test` can report success without exercising any UI contract, making the gate misleading.

**Concrete fix:** Add focused tests for postcode escaping/validation, analytics payload redaction, the three-call cap, waitlist failure behavior, and form state; then remove `passWithNoTests`.

### P3

#### P3-1 — `.env.example` is accidentally re-ignored

**Evidence:** `.gitignore:4` exempts `.env.example`, but the later `.env*` at `.gitignore:17` wins. `git check-ignore --no-index .env.example` reports line 17. The file remains present only because it is already tracked.

**Impact:** If the example is ever removed/renamed, Git will silently ignore its replacement; this undermines the “example names every key” convention.

**Concrete fix:** Remove the duplicate final `.env*` or place `!.env.example` after the final broad rule.

#### P3-2 — Public product branding is split between Relay and MedFind

**Evidence:** App metadata and UI use Relay (`app/layout.tsx:26-35`; `components/Footer.tsx:8-13`), while canonical project docs name MedFind (`CLAUDE.md:1-4`). F1 remains unresolved (`build-steps.md:83`).

**Impact:** Judges can see two product names across the site, repo, and video materials.

**Concrete fix:** Choose the submission name now and update metadata, logo text/labels, disclaimer, README/docs, and video consistently.

#### P3-3 — The new SECURITY DEFINER function retains default PUBLIC execute

**Evidence:** `waitlist_count()` is `security definer` and then granted to selected roles, but execution is never revoked from PostgreSQL's default `PUBLIC` role (`supabase/migrations/20260726031500_waitlist_and_realtime.sql:28-37`).

**Impact:** This contradicts the repo's explicit-grants convention and lets every current/future database role call the function. The exposed result is only a count, so severity is low.

**Concrete fix:** Add `revoke execute on function waitlist_count() from public;` before the targeted grants. Prefer an empty `search_path` plus schema-qualified table references for SECURITY DEFINER functions.

#### P3-4 — Vendored phase/status code is duplicated and one export is dead

**Evidence:** `CallPhase` is duplicated in `lib/pharmacies.ts:1-6` and `lib/search/types.ts:1-6`; status/timeline rendering is repeated across `components/RelayPanel.tsx:57-92` and `components/search/CallStatus.tsx:54-85`. `isSupabaseConfigured` is exported but unused (`lib/integrations/supabase-browser.ts:22`).

**Impact:** Phase names and visuals can drift between the landing demo and product UI—especially during the next state expansion.

**Concrete fix:** Consolidate the shared display/status vocabulary where practical, or explicitly name the landing type `DemoCallPhase`; remove the unused export.

#### P3-5 — Marketing statistics/testimonials are not auditable from the UI or repo

**Evidence:** Statistics have short source labels but no links/as-of dates (`components/StatsBar.tsx:13-31,55-65`). Named patient quotations/locations are hard-coded with no cited provenance or consent note (`components/Quotes.tsx:7-23,48-73`).

**Impact:** Reviewers cannot distinguish sourced evidence, composites, and invented demo copy.

**Concrete fix:** Add direct source links and as-of dates for statistics. Add provenance/consent documentation for quotes, or label them clearly as illustrative composites.

## F1–F7 decision status

| Decision | Review status |
|---|---|
| F1 Relay vs MedFind | **Unresolved; P3-2.** |
| F2 baseline 214 | **Unsafe as written; P2-6.** |
| F3 simulated ConnectFlow | **Submission blocker unless disclosed/disabled; P1-1.** |
| F4 postcodes.io, OSM, PostHog | **Do not sign off in current form; P1-2 and P1-3.** |
| F5 radius + NHS/private removed | Confirmed absent as documented. This review did not treat the flagged product choice as a merge defect. |
| F6 teammate Supabase signups | **Not verified**; no access/evidence in this repo shows their count, schema compatibility, or export status. |
| F7 Google variant dropped; Netlify retained | Google dependency/import appears removed. Netlify-on-Vercel failure is not harmless; P2-4. |

## Vercel/fresh-clone assessment

- No static peer-dependency blocker was found for Next 16 + React 19 + react-leaflet 5.
- Node `>=22` (`package.json:5-7`) satisfies the resolved Next package's Node requirement. Vercel must be configured to use a matching Node runtime.
- `package.json` and lockfile roots agree; scripts are conventional (`package.json:8-15`).
- Tailwind/PostCSS and the empty Next config have no static deployment blocker.
- The current server proves development compilation, and a pre-existing `.next/BUILD_ID` was newer than the vendored source. I did **not** count that as an independent clean production build.
- The actual Netlify fallback failure mode was exercised locally: POST returned 405. Code inspection proves it is swallowed; P2-4 explains why it is not always harmless.

## NOT VERIFIED — needs a real browser or unavailable runtime

- **Simulated calling flow:** clicking Search, watching every timed transition, reset/cancellation behavior, results transition, and ConnectFlow.
- **Combobox interaction/accessibility:** keyboard navigation, Escape/Tab behavior, touch selection, focus retention, and actual screen-reader announcements.
- **Dynamic accessibility:** live-region announcements when call rows change, focus placement when calling becomes results, map keyboard behavior, and final accessible names.
- **Responsive visual behavior:** whether the disclaimer is in view on real phone/desktop sizes, overlap/clipping, colour contrast, fonts, animations, and reduced-motion behavior.
- **Client runtime security:** executing the Leaflet postcode injection in a browser. The unsafe `innerHTML` data path is statically present.
- **External requests:** actual postcodes.io CORS behavior, OSM tile rendering/attribution, PostHog payloads/cookies/autocapture/session settings with a real key, and third-party retention.
- **Realtime:** owner-scoped anonymous sign-in, the exact two-feed `searches` + `calls` subscription, RLS isolation between sessions, update latency, reconnect behavior, and absence of transcript fields on the wire. The live engine is not part of this simulated route yet.
- **Waitlist persistence:** a real signup was not submitted because that mutates external state. Supabase insert/RPC behavior, abuse controls under load, teammate-project F6 data, and actual Vercel-host behavior remain unverified.
- **Production deploy:** `vercel deploy --prod` was not run. A clean `next build` was not rerun because it writes `.next`, and the review was restricted to creating only this report.
- **Fresh-clone install/build:** `npm install` was not run by instruction. Static lock/peer checks and the current no-emit typecheck passed, but a genuinely clean clone + install + production build remains unverified.
- **Current factual provenance:** the present-day truth of shortage/SSP labels, the three marketing statistics, and the named testimonials/consent could not be established from the repo.
- **Secrets outside the tracked/prospective tree:** `.env.local` contents were intentionally not printed or inspected; only its ignored/untracked status was verified. Git history and remote/Vercel/Supabase secret stores were not scanned.
- **Human review gates:** mobile/desktop approval, branding decision, third-party approval, and video framing remain Marvin/teammate decisions.

## Most important fix

Before anyone other than the team opens `/search`, make simulation impossible to mistake for reality: add a persistent simulated-demo disclosure, remove fake connection/prescription actions, and fail closed in production until the UI is driven by verified live call rows.
