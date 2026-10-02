# Design System: Pi Agent Desktop — Settings ▸ Model Management

> This file encodes the app's *existing* theme (extracted from
> `src/renderer/src/styles/foundation-body.css`), so generated screens for the
> settings model list and the add-model dialog look native to the app. It does
> not introduce a new palette — it documents the one already shipping.

## 1. Visual Theme & Atmosphere

A restrained, tool-like settings surface: cool near-white canvas, white cards
floating on hairline borders, and a neutral ink ramp that carries hierarchy
through weight and colour rather than size. Density is **Daily App Balanced
(5)** — rows are 44–52px tall, chips are compact, nothing is airy for its own
sake. Variance is **Predictable Symmetric (3)**: this is a settings page, so
every row is a left label with right-aligned controls. Motion is **Static
Restrained (2)** — short 150–240ms fades and slides, hardware-accelerated
transforms only, nothing loops forever. The mood is clinical but warm, like a
well-kept hardware control panel: quiet surfaces, one green signal colour that
only fires when something is on.

## 2. Color Palette & Roles

Light theme (default):

- **Page Mist** (`#FAFAFB`) — window background, the layer behind every card.
- **Canvas Silver** (`#F1F3F7`) — sidebar / rails / panel gutters.
- **Pure Surface** (`#FFFFFF`) — cards, rows on hover-lift, dialog body.
- **Inset Wash** (`#F7F8FA`) — recessed areas (code footers, empty states).
- **Field Grey** (`#EFF0F4`) — input and select fills.
- **Deep Ink** (`#1B1E26`) — primary text, and the fill of primary buttons
  (Add model, Save). Never pure black.
- **Muted Steel** (`#666D7C`) — secondary text: hints, metadata, descriptions.
- **Whisper Grey** (`#9AA0AE`) — tertiary text: placeholders, timestamps,
  counts. Must sit on surface only where contrast allows.
- **Hairline** (`#E3E5EC`) — 1px borders and dividers. **Shadow Ring** is a
  1px solid version of the same value, never a blur.
- **Hairline Strong** (`#DBDEE6`) — input borders and control outlines.
- **Signal Green** (`#2E9E6B`) — **the single accent.** Fires only on: an
  enabled Switch, an "in use" badge, a positive confirmation chip. Tint
  companion `#E7F5EE` for its chip background. Saturation stays under 80%.
- **Notice Amber** (`#D98324`) with tint `#FCF1E3` — warnings and
  "overridden in models.json" badges.
- **Alert Coral** (`#DC4B41`) with tint `#FBEAE9` — destructive actions and
  error notices only.
- **Depth Violet** (`#7A4DE0`) with tint `#F1EAFE` — **restricted to thinking
  depth badges** (Max / Ultra). It never becomes a button, a glow, or a
  gradient.

Dark theme maps the same roles: page `#16181C`, canvas `#1B1E23`, surface
`#23262C`, field `#2A2D34`, hairline `#33363E`, green `#4FBE8B`, amber
`#E69A4B`, coral `#E4675C`, violet `#9B6FF0`. Its label ramp lifts the two
middle levels above the light theme's mirror image — `#F3F4F6` / `#C4C7CC` /
`#A2A5AB` — because a step that reads as hierarchy on white reads as the same
grey wash on near-black; plus a fourth, dimmer level (`#5B5D62`) for what has to
read as *empty* rather than as quiet: placeholders and other dimmed affordances.
Light-on-dark glyphs also keep the platform's own font smoothing (see the
dark-mode block in `index.css`): forcing `antialiased` there thins every stem and
turns white into grey.

## 3. Typography Rules

- **Body / Display:** **Geist** (variable) — track-tight (`-0.01em`),
  weight-driven hierarchy: 13px/500 section titles, 12.5px/400 row labels,
  11px/400 hints, 10.5px/500 uppercase micro-labels with `0.4px` tracking.
  Headings never exceed 15px in this surface.
- **Mono:** **Geist Mono** — every machine identifier: model ids
  (`claude-sonnet-4-5`), provider keys, token counts, paths, thresholds.
  Numbers that line up in a column are tabular-nums.
- **Banned:** Inter (the app ships Geist), generic serifs anywhere in UI,
  all-caps sentences, gradient text.

## 4. Component Stylings

- **Buttons:** flat, no outer glow. Primary = Deep Ink fill, white 12px label,
  28px tall, radius 8. Secondary = white fill + hairline ring + shadow-btn;
  hover lifts the fill to Inset Wash. Active state presses down (no scale on
  desktop). Ghost/text buttons turn from Muted Steel to Deep Ink on hover.
- **Switches:** 32×18 pill, track Signal Green when on / `#C9CCD6` when off,
  14px white knob, 200ms track and 240ms knob transition (`0.23,1,0.32,1`).
  The only place green appears at size.
- **Chips / badges:** radius 6, 20px tall, Field Grey fill, 10.5px Muted Steel
  label; optional 10px leading icon. Capability chips in a row are separated
  by 4px and never wrap past two lines — the row truncates instead.
- **Cards (Section):** radius 10, white, 1px hairline ring, header row
  12px/13px label with an optional trailing action; rows inside are divided by
  hairline borders, 4px/16px padding rhythm. Use cards only for grouped
  settings — no nested cards.
- **Inputs / selects:** Field Grey fill, 1px Hairline Strong ring, radius 8,
  28px tall, 12px text (mono for ids). Focus = 3px soft accent-tint ring, no
  outline. Labels sit above the field at 11.5px/500 Muted Steel; helper text
  below at 10.5px Whisper Grey; errors below that in Alert Coral.
- **Rows (model list):** one row = model name (12.5px ink) + mono id (10.5px
  whisper) on the left, capability chips in the middle, switch + edit + delete
  on the right. Disabled rows drop to 55% opacity but keep full layout — a
  greyed row, never a removed one.
- **Dialog:** centered card, max-width 480, radius 10, shadow-overlay;
  backdrop `black/25` light / `black/50` dark with a 180ms fade; the card pops
  in over 220ms with `0.23,1,0.32,1` from bottom-center. Footer buttons sit
  right-aligned: ghost Cancel, Deep Ink Save. Destructive delete is a coral
  ghost on the far left, always behind a second confirmation.
- **Loaders:** skeleton bars matching the row dimensions — no spinners.
- **Empty states:** one composed line of guidance (what to do next), not a
  bare "No data".

## 5. Layout Principles

- Single settings column, `max-width: 720px`, centered inside the content
  pane; a 248px left rail holds the category nav. No horizontal scroll.
- Sections stack with 24–32px gaps; rows within a section are flush-divided by
  hairlines rather than spaced apart.
- Right-aligned controls are optically aligned on one column; labels clamp to
  one line with a wrapping hint beneath (never a truncated sentence).
- Below 768px (window minimum is 1100, but the rule holds for the dialog):
  dialog becomes full-width minus 32px; chips wrap under the title; no element
  overlaps another — each occupies its own zone.
- Touch/pointer targets are ≥28px tall for controls, ≥44px for list rows with
  icon buttons inset 8px.

## 6. Motion & Interaction

- Transitions: 150ms hover fades, 200–240ms switch and popover motion,
  220ms dialog pop, 180ms backdrop fade. Easing `cubic-bezier(0.23,1,0.32,1)`
  for anything that settles, `ease-out` for colour.
- Staggered reveals only for freshly mounted lists (30ms cascade, max 8 rows).
- Animate transform/opacity only — never width, height, top, or left.
- No perpetual loops: nothing pulses, shimmers, or spins while idle.
- Reduced motion collapses every duration to 0.01ms (already global).

## 7. Anti-Patterns (Banned)

- No emojis anywhere in the UI.
- No Inter font; no generic serif fonts.
- No pure black `#000000` — Deep Ink `#1B1E26` is the floor.
- No neon glows, purple button halos, or gradient text; Depth Violet only on
  thinking-depth badges.
- No oversaturated accents; Signal Green is the single accent and only marks
  "on".
- No three-equal-cards feature rows; no centered hero blocks.
- No custom cursors; no overlapping/absolute-stacked content.
- No fake round numbers (`99.99%`) and no placeholder names ("John Doe",
  "Acme", "Nexus") — use real model ids from the catalogue.
- No AI copywriting clichés ("Elevate", "Seamless", "Unleash", "Next-Gen").
- No filler UI text ("Scroll to explore", bouncing chevrons).
- No circular spinners where a skeleton can match the layout.
