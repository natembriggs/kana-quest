# Colour contrast — implementation plan

Status: **draft, 2026-09-08, not yet built.** Written at the app owner's
request after `kanaquest-evaluation.md`'s original P1 accessibility finding
turned out to be only half fixed: `1de948a`'s accessibility pass gave the
app real tab/toggle semantics, `aria-live` feedback, and `prefers-reduced-
motion` support, but never touched colour — the light-theme accent and the
mastery-tier green it originally measured as failing WCAG AA are pixel-for-
pixel unchanged. Every ratio below was computed directly from the values in
`styles.css` as they stand today, not estimated or carried over from the
original review.

**The brief this plan works to, given directly by the owner:** not every
colour needs to clear WCAG AA. Mastery-tier colours are the app's own
information, not a personalization choice, and should simply be correct.
The accent colour picker is personalization — keep the full ten-colour
breadth rather than narrowing it, make the AA-passing options identifiable
for a learner or parent who cares, and treat forcing every one of the ten
into compliance as a real trade-off against how vivid the palette looks,
not a foregone conclusion. All current users are UK-based; nothing below
assumes a specific jurisdiction's legal obligation to comply (this is a
family app, not a public-sector or commercial one under the UK
Accessibility Regulations) — WCAG AA is adopted here as a legibility
target on its own merits, not a compliance exercise.

---

## 1. What's actually broken — measured, not estimated

Every figure below is a real WCAG 2 contrast ratio (`(L1+0.05)/(L2+0.05)`
over relative luminance), computed from the exact hex values in `styles.css`
today. AA thresholds: **4.5:1** for normal text, **3:1** for large text
(≥24px regular, or ≥19px/14pt bold) and for non-text UI components.

### 1.1 The accent colour picker (`ACCENT_COLORS` in `app.js`, ten choices)

Each accent is used as a background with `--accent-ink` text on it — badges,
primary buttons, selected states. Sizes vary; several of these render as
ordinary body-size text (17px, not bold — see §1.3), so 4.5:1 is the
realistic bar, not 3:1.

| Colour | Light ink-on-accent | Dark ink-on-accent |
| --- | --- | --- |
| Coral (default) | 3.62 — **fails** | 6.70 — passes |
| Blue | 4.55 — passes | 7.37 — passes |
| Purple | 5.09 — passes | 7.09 — passes |
| Pink | 3.54 — **fails** | 7.82 — passes |
| Teal | 3.65 — **fails** | 8.95 — passes |
| Amber | 5.52 — passes | 9.92 — passes |
| Green | 3.45 — **fails** | 8.87 — passes |
| Indigo | 5.98 — passes | 7.27 — passes |
| Crimson | 5.16 — passes | 6.97 — passes |
| Sky | 3.68 — **fails** | 9.79 — passes |

**Dark theme already passes AA on all ten, comfortably, with no changes.**
This isn't luck: the dark-theme swatches are lighter/more pastel than their
light-theme counterparts and are paired with dark ink rather than white
(`--accent-ink` flips per theme in `styles.css`), which is exactly the
pattern that makes light colours legible. Light theme never adopted that
pattern — every light-theme accent but amber uses white ink regardless of
how light the accent itself is.

**Five of ten already pass in light theme** (blue, purple, amber, indigo,
crimson) with no change needed. **Five fail** (coral — the default —, pink,
teal, green, sky), all for the same reason: a mid-brightness hue paired
with white text.

### 1.2 The mastery-tier scale (`--tier-0` through `--tier-4`)

Two separate, differently-broken uses of the same four colours:

**As a tile background** (`.overview-tile.tier-N`, the set-overview grid —
the glyph itself is `color: var(--tier-N-ink)` on `background: var(--tier-N)`):

| Tier | Light | Dark |
| --- | --- | --- |
| 1 | 7.66 — passes | 8.67 — passes |
| 2 | 7.39 — passes | 5.38 — passes |
| 3 | **2.52 — fails badly** | 3.54 — passes (large text only) |
| 4 | 4.31 — passes large text only, just under 4.5 | 8.02 — passes |

Tier 3 in light theme is the single worst number in the app — this is what
the original evaluation caught, and it's still exactly that bad.

**As label text** (`.mastery-label.tier-N`, the tier name shown on every
character/word detail screen — `#detail-mastery`, 17px, bold, on `--bg`):
this pairing was never measured before and is worse than the tile case.

| Tier | Light | Dark |
| --- | --- | --- |
| 1 | **1.46 — fails badly** | **2.79 — fails** |
| 2 | **1.46 — fails badly** | **2.79 — fails** |
| 3 | **2.36 — fails badly** | 5.13 — passes |
| 4 | 4.02 — just under 4.5 | 8.43 — passes |

**Tiers 1 and 2 share one bug, not two separate near-misses**: `.mastery-
label.tier-1` and `.mastery-label.tier-2` both read `color: var(--tier-2)`
— tier 1's label is rendered in tier 2's colour outright, evidently a
copy-paste slip, and *that* colour was never chosen to be read as text on
`--bg` in the first place (it was chosen as a light tile fill). 17px bold
is below the 18.66px/14pt bold "large text" threshold, so this needs the
full 4.5:1, not 3:1 — there's no size-based excuse for either the bug or
the ratio.

### 1.3 Why 17px/20px count as "normal", not "large", text

`body { font: 17px/1.45 ... }`, inherited by `.mastery-label` (bold, no
size override) — 17px doesn't clear 18.66px even bold. `.overview-tile`'s
glyph is `font-size: clamp(20px, 6vw, 28px)`, no bold — 20px, the size a
narrow phone actually renders, doesn't clear 24px regular either. Both need
4.5:1 to be safe on a real phone, not the more forgiving 3:1 — this plan
targets 4.5:1 throughout rather than assuming the larger end of each clamp.

---

## 2. Recommended fixes

### 2.1 Mastery tiers — fix outright, not a "look" trade-off

This is the app's own information (how well a learner knows something), not
a personalization choice, so the brief's "not everything needs to be
accessible" doesn't apply here — the target is full AA, both themes, both
uses.

**Tile ink (glyph colour on the tile):**

- **Tier 3, both themes: switch the ink from white to a dark colour
  already in the palette, leave the fill untouched.** Light: `--ink`
  (`#23201e`) on the current tier-3 fill (`#5cb663`) is **6.42:1** — no hue
  or lightness change to the fill itself, which matters because a same-hue
  darkening strong enough to fix white-on-tier-3 lands tier 3 almost
  exactly on top of tier 4 (`#3c8642` vs. tier 4's `#2e8b3d`), destroying
  the five-step gradient the whole scale depends on being readable at a
  glance. Dark: reuse `--tier-4-ink` (`#0c1f0e`) on the dark tier-3 fill
  (`#3f9a4c`) for **4.88:1**.
- **Tier 4, light theme only: a barely-visible fill nudge**, `#2e8b3d` →
  `#2d873b` (well under one percentage point of lightness), closes 4.31 to
  a clean **4.50** with the existing white ink. Dark theme's tier 4
  (8.02) needs nothing.
- Tiers 1, 2, and 0 need no change in either theme.

**Label text (`.mastery-label.tier-N`):** don't reuse `--tier-N` or
`--tier-N-ink` here — both were chosen for a different pairing (fill+ink on
a tile) and neither is calibrated for text-on-`--bg`. Add dedicated
`--tier-N-label` tokens instead, so fixing this never fights the tile
choices again:

| Token | Light (on `--bg`) | Dark (on dark `--bg`) |
| --- | --- | --- |
| `--tier-1-label` | reuse `--tier-1-ink` `#2f5233` — 8.26 | reuse `--tier-1-ink` `#a9dbac` — 11.58 |
| `--tier-2-label` | reuse `--tier-2-ink` `#1f4023` — 10.8 | reuse `--tier-2-ink` `#d9f0da` — 15.04 |
| `--tier-3-label` | new `#3a803f` — 4.52 | current `--tier-3` `#3f9a4c` already passes — 5.13, no new token needed |
| `--tier-4-label` | new `#2b8239` — 4.50 | current `--tier-4` `#57c765` already passes — 8.43, no new token needed |

Tiers 1 and 2 need no new colour at all, just correcting the copy-paste bug
to point at each tier's own existing `-ink` token, which already happens to
have excellent contrast as text-on-`--bg` too. Tiers 3 and 4 need one new
token apiece in light theme only.

**Open call, not resolved here:** the tier-3-label and tier-4-label
candidates above are close to each other in hue and lightness (both had to
darken toward the same "reads as dark green on cream" target to clear
4.5:1), so the visual step between them is smaller than tiers 1→2's. Worth
an eye on a real phone next to the actual tier name text before finalizing
— if 3 and 4 read as too similar, favour giving 4 a small hue shift instead
of matching lightness so precisely.

### 2.2 Accent colour picker — keep the breadth, make accessible options findable

Per the brief: don't shrink the ten-colour set. Two independent moves,
either or both:

**A. Nudge the three "cheap" failures, leave the picker at ten colours,
end up with eight passing instead of five.** Teal, green, and sky only
need small darkenings to clear 4.5:1 — 4, 6, and 4 percentage points of
HSL lightness respectively, chosen to hold the same hue exactly:

| Colour | Current | AA-passing (same hue) | Visual shift |
| --- | --- | --- | --- |
| Teal | `#12968a` | `#10857a` | small — same teal, slightly deeper |
| Green | `#2f9e44` | `#28883a` | small — same green, slightly deeper |
| Sky | `#0891b2` | `#07819f` | small — same blue-teal, slightly deeper |

These three are genuinely low-cost — worth just doing.

**B. Coral (the default!) and pink are the real trade-off the brief is
about.** Both need a bigger nudge — 9 percentage points of lightness each
— to clear 4.5:1:

| Colour | Current | AA-passing (same hue) |
| --- | --- | --- |
| Coral | `#e8553d` (default) | `#df361a` |
| Pink | `#e0559a` | `#d92e83` |

Coral is the app's unattributed default and its most-seen colour — a 9pp
darkening is a visibly different coral (more red-orange than the current
warm coral), not a rounding error. This is a real "does accessibility limit
the look" case, and the honest answer for a colour this central is "maybe,
a bit" — recommend the owner actually look at both swatches side by side on
a phone before deciding, rather than this plan presupposing the answer
either way. Amber already proves the alternative works fine: it's the one
light-theme colour that already ships with dark ink instead of white
(`--accent-ink: #2a1600`) and passes at **5.52** without having been
darkened at all — giving coral/pink dark ink instead of a darker fill is a
second option worth eyeballing alongside the darkened-fill one, since it
changes nothing about the fill colour itself, only the text sitting on it.

**C. Whatever the owner decides on A/B, make the passing set identifiable
in the picker**, so a parent who cares can tell at a glance. `renderColorPicker()`
(`app.js`) currently renders ten plain swatch buttons with only an
`aria-label`, no visible marker. Options, in rough order of how much visual
weight they add — a real-phone call, not decided here:
  - A small checkmark or dot overlaid on each AA-passing swatch, plus one
    line of `.hint` text under the picker explaining what it means.
  - No per-swatch marker; one line of hint text naming which colours pass
    ("Blue, Purple, Amber, Indigo and Crimson meet accessibility contrast
    guidelines").
  - A `title`/tooltip-only signal (screen-reader and hover only, nothing
    visible at rest) — cheapest, but a parent skimming the screen won't see
    it, which undercuts the point of surfacing this at all.

The first option matches how `--accent` already gets a `.selected` marker
today (a small visual overlay on the swatch itself), so it's likely the
most consistent with the existing picker's own visual language — but
confirm on a real phone rather than assuming from the CSS alone.

---

## 3. What this plan deliberately doesn't touch

- **`--ok`/`--bad`/`--ok-bg`/`--bad-bg`** (quiz right/wrong feedback) —
  not measured here; if the mastery-tier work goes well, a quick follow-up
  audit of these is cheap and worth doing, but it's a different, separately
  scoped check, not assumed broken.
- **Anything in `feedback-plan.md`'s or `kanji-mnemonic-plan.md`'s own UI**
  (the improvement-garden graphic, hint buttons) — out of scope; those use
  `--accent`/`--ink`/`--tier-*` already, so fixing the tokens here improves
  them for free without a separate pass.
- **Non-colour accessibility** (focus order, live regions, tab semantics)
  — already done, `1de948a`, not reopened by this plan.

---

## 4. Implementation notes for whoever builds this

- All of §2.1's fixes are pure `styles.css` token changes — no `app.js` or
  markup change, since `.overview-tile.tier-N`/`.mastery-label.tier-N`
  already read from CSS custom properties. Low risk, easy to review as a
  diff of hex values.
- §2.2.A/B (accent swatch changes, if adopted) touch both the `swatch` field
  in `ACCENT_COLORS` (`app.js`) and the matching `:root[data-accent="..."]`
  rule in `styles.css` — the two are hand-kept in sync today (confirmed by
  reading both; no build step generates one from the other), so a change to
  one without the other would make the picker preview lie about the colour
  actually applied. Worth a quick script or test asserting they match,
  while this is being touched anyway.
- §2.2.C (picker UI) is the one genuinely new bit of markup/JS in this
  plan — everything else is a value change to an existing token.

## 5. Testing

Nothing today catches a contrast regression automatically — this whole plan
exists because a fix shipped for every *other* part of the original P1
finding except this one, silently, for two weeks. Worth adding a small
`test/contrast.js` (plain JS, same WCAG-ratio formula used to produce every
number in §1, no new dependency) that asserts every `--accent`/`--accent-
ink` pair and every `--tier-N`/`--tier-N-ink`/`--tier-N-label` pair meets
its target ratio, reading the actual hex values out of `styles.css` (or a
small hand-kept table mirroring it, if parsing the stylesheet directly is
more trouble than it's worth) — so the *next* colour token nobody thought
to re-check doesn't sit broken for weeks unnoticed again. Deliberately not
asserting on the five colours §2.2.B leaves as a real, undecided trade-off
(coral/pink, if left at their current values) — the test should encode
"passes AA" only for the tokens this plan actually commits to fixing, not
turn into a blanket requirement the picker was never meant to have.

## 6. Open questions

- **Coral and pink (§2.2.B): darken the fill, or switch to dark ink like
  amber already does, or leave as the one deliberately vivid pair?** Not
  decided here — needs an eye on a real phone. Whichever way this goes,
  it's the one part of this plan that's a genuine judgement call rather
  than a correctness fix.
- **The three-option picker-UI question in §2.2.C** — same "real phone,
  not a spec" caveat every other plan in this repo hits for visual design
  calls.
- **§2.1's tier-3-label/tier-4-label closeness** — flagged, not resolved.
- Whether `--ok`/`--bad` (§3) turn out to need the same treatment once
  someone actually measures them — presumed fine, not verified.
