# DESIGN.md — MedFind doc & product family

_Established 2026-07-25 across the architecture-doc artifacts; tokens settle further with the first app build._

## World

- NHS-adjacent trust: UK healthcare's two honest colors do the work — **NHS blue** (system/technical) and **UK pharmacy-cross green** (human/plain). Everything else stays quiet.
- Honesty-first voice: timestamps over promises ("confirmed by phone at 14:32"), "couldn't check" over silence, bullets over paragraphs (owner is a visual learner — never write paragraph blocks in docs/UI).

## Tokens

| Role | Light | Dark |
|---|---|---|
| Ground | `#F6F8FB` | `#0D141C` |
| Card | `#FFFFFF` | `#151F2B` |
| Ink | `#14212F` | `#E6EDF4` |
| Muted | `#5A6B7D` | `#96A7B8` |
| Line | `#D8E1E9` | `#2A3846` |
| Blue (tech register) | `#0B63B8` / tint `#EAF2FB` | `#66AEEA` / tint `#16293D` |
| Green (plain register / good) | `#0B613F` / tint `#E9F5EF` | `#52C08E` / tint `#132C20` |
| Warn | `#9A5C00` / `#FAF1E2` | `#E0A34A` / `#3A2C14` |
| Critical | `#B3362B` / `#F9EBE9` | `#E07862` / `#3C1F1A` |

- Themes: token-level custom properties on `:root`; redefine under `@media (prefers-color-scheme: dark)`, then `:root[data-theme="dark"]` and `:root[data-theme="light"]` must win both directions.

## The two-register system (signature)

- Every concept explained twice, side by side: **Plain English** panel (green tint, call-centre metaphor voice) + **Under the hood** panel (blue tint, engineer voice).
- Panels: tinted ground, 1px tinted border, 12px radius, small semibold sentence-case lane tag. Never a colored side-border >1px; never nested cards.

## Type

- Display: Avenir Next (600/700), tracking −0.01…−0.02em, `text-wrap: balance`.
- Body: system-ui stack, 15.5–16px / 1.55, measure ≤72ch.
- Mono (SF Mono stack): only code, endpoints, state names, and numerals in tables (`tabular-nums`). Mono is data, not decoration.

## Grammar

- Cards: 1px `--line` border, 12–14px radius, no drop shadows on flat doc surfaces; diagrams live in cards with `overflow-x: auto`.
- No uppercase eyebrow on every section; wayfinding lives in a sticky rail (desktop) / chip row (mobile).
- Numbered markers only where sequence is real information (build order, call steps).
- Semantic color (good/warn/critical) is separate from the two register hues.
- Motion: one authored moment per surface (hero settle-in); everything else instant; full `prefers-reduced-motion` respect.
- Mermaid diagrams: default runtime theme, framed by cards; single-line captions.
