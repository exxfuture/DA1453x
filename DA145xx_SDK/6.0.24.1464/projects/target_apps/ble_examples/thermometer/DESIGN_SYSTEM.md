# Thermometer design system — "Pine & Ember"

This is the single written reference for the platform's visual language:
fonts, type scale, colors (primary/secondary/accent/warning/error), spacing,
radius, shadow, motion, and the rules for applying them. It documents tokens
that already exist in code — it does not introduce new ones. Several
component files (`fe/src/components/ui/Button.tsx`, `Alert.tsx`,
`StatCard.tsx`, `Table.tsx`, `EmptyState.tsx`, `theme/chartColors.ts`)
reference a "design spec §N" by section number; this file *is* that spec,
finally written down, with matching section numbers so those comments
resolve to something real.

**Source of truth**: the token *values* live in code, not here — this doc
describes and cross-references them, it doesn't fork them:

- `fe/tailwind.config.js` (`theme.extend`) — color ramps, type scale, radius,
  shadow tokens, spacing, motion.
- `fe/src/index.css` — the actual light/dark CSS-variable values for every
  semantic/role token, `@fontsource` imports.
- `deploy/keycloak/themes/thermometer/login/resources/css/login.css` — a
  **hand-maintained CSS-only mirror** of the same tokens for the Keycloak
  hosted login/password pages, which run in a separate origin the React app
  cannot theme directly. See §7.

If code and this doc disagree, code wins — but that disagreement is a bug in
this doc, not a shrug; fix the doc in the same change that touches the
tokens (see the repo's `CLAUDE.md`, "Working guidelines").

## §1. Principles

- **Health-oriented, not generic SaaS.** Teal-green primary + warm
  terracotta accent + warm-neutral (not cool-gray) grays, deliberately
  avoiding the generic gray/blue admin-panel look.
- **One system, two registers, not two palettes.** Customer-facing pages are
  spacious and warm; doctor/admin pages are dense and clinical. Both pull
  from the same tokens — the difference is spacing density and which
  optional accents (the `warm` Button variant) are allowed, never a
  substitute color. See §6.
- **Color never carries meaning alone.** Every status badge, alert, and
  temperature tier pairs its color with an icon and a text label. Relevant
  for colorblind users and for print (§8).
- **Tokens over hex.** Components consume Tailwind color/spacing/radius
  utilities backed by the tokens below, not ad-hoc values. A 2026-08-07
  token-consistency audit (`fe/README.md`) grepped the whole `src/` tree for
  raw color utilities outside the token layer and found exactly one
  offender in three figures of components — that's the bar to hold going
  forward: if you're about to reach for a raw Tailwind color class, a token
  is almost always the right answer instead.

## §2. Typography

Three self-hosted (`@fontsource`) font families — no third-party font
requests from the app:

| Role | Family | Tailwind key | Used for |
|---|---|---|---|
| Display/serif | Fraunces (variable) | `font-display` | Hero numerals (live temperature reading), headings that need editorial warmth |
| UI/sans | Public Sans | `font-sans` (default) | Everything else — body text, labels, buttons, nav |
| Mono | IBM Plex Mono | `font-mono` | Device IDs, MAC addresses, other tabular/technical strings |

Type scale (`fe/tailwind.config.js` → `theme.extend.fontSize`):

| Token | Size / line-height | Use |
|---|---|---|
| `hero-1` | 4.5rem / 1, tracked -0.02em | The single largest live-reading numeral |
| `hero-2` | 3rem / 1.05, tracked -0.02em | Secondary hero numerals |
| `display` | 2rem / 1.15, semibold | Section-level display text |
| `h1` | 1.75rem / 1.2 | Page titles |
| `h2` | 1.375rem / 1.25 | Section headings |
| `h3` | 1.125rem / 1.3 | Card/subsection headings |
| `body-lg` | 1rem / 1.5 | Emphasized body copy |
| `body` | 0.875rem / 1.5 | Default UI text |
| `caption` | 0.8125rem / 1.4 | Helper text, timestamps |
| `label` | 0.75rem / 1.3, tracked 0.04em | Uppercase field labels, badges |
| `mono-sm` | 0.8125rem / 1.4 | Small monospace strings |

Numeric/tabular data (readings, timestamps in tables) uses `.font-tabular`
(`font-variant-numeric: tabular-nums`, `fe/src/index.css`) so digits align
in columns.

## §3. Color

### 3.1 Primitive ramps (non-semantic UI chrome)

Identical hex in light and dark mode — components reach dark-mode contrast
via explicit `dark:` variants, not a ramp swap. Defined in
`fe/tailwind.config.js` → `theme.extend.colors`.

**Primary — Pine** (teal-green; the brand's one primary color):

| Step | Hex | Typical use |
|---|---|---|
| 50 | `#EFF9F5` | Tint backgrounds |
| 100 | `#D7F0E7` | |
| 200 | `#AFE1D0` | |
| 300 | `#7FCBB4` | Dark-mode text/border on dark surfaces |
| 400 | `#4FAF97` | |
| 500 | `#2F9481` | |
| **600** | **`#1F7A6A`** | **Primary button fill, links, focus ring base** |
| 700 | `#186257` | Primary button hover |
| 800 | `#144E46` | Primary button active, display-font headings |
| 900 | `#123F39` | |
| 950 | `#082621` | |

**Secondary — Sand** (warm neutral; replaces cool gray everywhere — text,
borders, surfaces, disabled states):

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 0 | `#FAF9F6` | | 500 | `#8A8069` |
| 50 | `#F5F3EE` | | 600 | `#6E6552` |
| 100 | `#EDEAE2` | | 700 | `#564F41` |
| 200 | `#DEDACD` | | 800 | `#3D3830` |
| 300 | `#C7C1AF` | | 900 | `#27231F` |
| 400 | `#A79E88` | | 950 | `#17140F` |

**Accent — Ember** (warm terracotta/orange; customer-facing encouragement
CTAs only — the `warm` Button variant. Never on doctor/admin pages, see
§6):

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 50 | `#FFF4EC` | | 500 | `#ED6F1F` |
| 100 | `#FFE4CC` | | 600 | `#CC5814` |
| 200 | `#FFC896` | | 700 | `#B84E10` |
| 300 | `#FFA75F` | | 800 | `#7C3714` |
| 400 | `#F98A3C` | | 900 | `#5C2B12` |

**Garnet** (destructive-action red; only the steps a solid destructive
Button fill needs — everything else routes through the tinted `danger.*`
role token below):

| Step | Hex |
|---|---|
| 50 | `#FDEDEA` |
| 600 | `#B8341F` |
| 700 | `#A62F1C` |
| 800 | `#7D2315` |

### 3.2 Semantic role tokens (theme-aware, light + dark)

CSS variables in `fe/src/index.css`, consumed via `rgb(var(--color-*) /
<alpha-value>)` in `tailwind.config.js` so Tailwind's opacity modifiers
(`/50` etc.) work. Each role is a `text` / `tint` / `border` triple.

| Role | Meaning | Light `text` | Dark `text` |
|---|---|---|---|
| `success` | Confirmations, healthy states | `rgb(35 122 59)` | `rgb(85 195 119)` |
| `warning` | Non-blocking caution | `rgb(184 78 16)` | `rgb(249 138 60)` |
| `danger` / **error** | Failures, destructive confirmations, validation errors | `rgb(184 52 31)` | `rgb(240 112 90)` |
| `info` | Neutral informational | `rgb(37 104 200)` | `rgb(111 163 238)` |

Structural tokens (also theme-aware): `page`, `surface-1/2/3`,
`border.hairline`, `ink.primary/secondary/muted`. These are what every page
background, card surface, and body/caption text should reference — not
`primary`/`sand` numeric steps directly, which stay static across themes by
design.

### 3.3 Temperature tiers

A dedicated 5-step scale (`fe/src/theme/temperature.ts`,
`getTemperatureTier`) drives the dashboard hero color, badges, and chart
tooltips — distinct from the general `warning`/`danger` roles because a
clinical reading needs finer gradation than "ok vs. not ok":

`low` → `normal` → `elevated` → `fever` → `highFever`, each with its own
`text`/`tint`/`border` triple (light + dark, see `fe/src/index.css`) and a
paired icon (never color alone, per §1).

### 3.4 Shadows

`fe/src/index.css` `--shadow-{xs,sm,md,lg,focus}`, exposed as
`shadow-{xs,sm,md,lg,focus}` in Tailwind. Dark mode drops the `xs`/`sm`/`md`
tiers in favor of a hairline border (`border-border-hairline/[0.08]`) —
shadows barely read against a near-black surface; `lg` and `focus` still
render (heavier, higher-contrast rgba). `--shadow-focus` (`0 0 0 3px
rgba(31,122,106,.35)` light / `rgba(127,203,180,.35)` dark) is the one
non-negotiable a11y hook: every interactive element's `:focus-visible`
state must show it or the Keycloak equivalent (§7).

## §4. Spacing, radius, motion

- **Radius**: `sm` 6px, `md` 10px, `lg` 16px, `xl` 24px
  (`tailwind.config.js` → `borderRadius`). Inputs/buttons use `md`
  (rendered as the commonly-seen 8px in component code, e.g.
  `Input.tsx`/`Button.tsx`'s `rounded-md`); cards use `lg`; the login card
  uses `lg` (16px) too.
- **Touch target**: `spacing.touch` = `2.75rem` (44px) — the height of
  `Input`/`Button` `md` size, and the width Keycloak's password-toggle
  button is now pinned to (§7) so it reads as a proper square touch target
  instead of shrink-to-content.
- **Motion**: `transitionDuration.fast/base/slow` = 120/200/320ms,
  `transitionTimingFunction.standard` = `cubic-bezier(0.2, 0, 0, 1)`. All
  motion is disabled under `prefers-reduced-motion: reduce`
  (`fe/src/index.css`).

## §5. Component kit

`fe/src/components/ui/` — `Button`, `Card`, `Input`, `Badge` (+
`TemperatureBadge`/`ConnectionBadge`), `StatCard`, `Table` primitives,
`EmptyState`/`SkeletonBlock`/`ErrorState`, `Alert`, `Timeline`, `Pagination`,
`ProgressBar`, `TrendChart`. Icons are `lucide-react` throughout — don't mix
in another icon set.

`Button` variants (`fe/src/components/ui/Button.tsx`): `primary` (Pine
solid), `secondary` (Pine outline), `tertiary` (Pine text), `warm` (Ember
solid — customer-only, §6), `destructive` (Garnet solid). Sizes `sm`/`md`/
`lg` at 36/44/52px height.

## §6. Density: two registers, one system

Customer pages: `Card density="comfortable"` (more padding), `warm` Button
variant allowed, copy tone is encouraging. Doctor/admin pages: `density="compact"`,
no `warm` variant, `Table`-dominant layouts, copy tone is clinical/neutral.
This is the *only* axis that differs between the two contexts — same color
tokens, same type scale, same components.

## §7. Cross-origin parity: the Keycloak login theme

Keycloak's hosted login/registration/password pages
(`deploy/keycloak/themes/thermometer/login/`) run on a separate origin
(`localhost:8082`, a different Keycloak process serving PatternFly-based
markup) that the React app cannot theme directly — there is no shared
token file it can import. `login.css` is therefore a **hand-written,
CSS-only mirror** of §2/§3/§4's values on top of Keycloak's stock
`keycloak.v2` theme (`theme.properties`: `parent=keycloak.v2`), targeting
both PatternFly's own CSS custom properties and plain element/class
selectors as a fallback. No forked FreeMarker templates, so it survives
Keycloak version bumps.

**This mirror drifts if §2/§3/§4 change and `login.css` isn't updated in
the same pass** — there is no build step that keeps them in sync. When you
change a color, font, radius, or shadow token in `tailwind.config.js` /
`index.css`, check whether `login.css`'s hard-coded hex values need the
same edit.

**Known-fragile spots**, found by inspecting the actual rendered DOM/CSS
(not guessed) while fixing the bugs below — worth knowing before touching
this file again:

- Keycloak wraps a plain input in `<span class="pf-v5-c-form-control">` —
  the *span*, not the `<input>`, is the visible bordered box. Styling both
  independently (a border on each) produces a faint double border/ring;
  only the span should carry border/radius/background, with `:focus-within`
  (not `:focus`, which never fires on the span) for the focus ring.
- `.pf-v5-c-form-control` has PatternFly's own `:before`/`:after`
  pseudo-element border layer (an animated bottom-border validation/focus
  indicator) drawn *underneath* whatever border we set, colored from
  PatternFly's own unthemed custom properties — left alone it shows as a
  stray colored line under every text field regardless of our styling or
  focus state. Fixed by neutralizing both pseudo-elements
  (`content: none`) rather than chasing their separate color variables.
- The password field's show/hide toggle
  (`<button class="pf-v5-c-button pf-m-control">`, inside
  `.pf-v5-c-input-group`) falls back to PatternFly's stock "control" button
  skin if untargeted — a dark fill with a barely-visible icon glyph. Now
  styled as part of one merged input-group control (shared border/radius,
  transparent background, `sand-600` icon → `primary-600` on hover/focus,
  `2.75rem` width matching the `touch` spacing token) instead of a foreign
  dark chip bolted onto the side of the field.
- `.pf-v5-c-button` (the toggle's own element, separate from
  `.pf-v5-c-form-control`) has *its own* `:before`/`:after` full-border
  overlay (`inset: 0`), and `.pf-m-control:hover:after` grows that overlay's
  bottom-border width and recolors it from a PatternFly hover variable that
  resolves through our `:root` primary-color override — i.e. the exact same
  stray-pseudo-border bug as the text fields, but on the button, only
  visible on hover ("bottom shadow that grows green" on the toggle). Same
  fix again: neutralize `.pf-v5-c-button.pf-m-control:before/:after`
  (`content: none`) rather than override the hover border-color variable.
  **Any new PatternFly-based element styled in this theme should be
  checked for this same `:before`/`:after` pattern up front** — it's shown
  up on both the input span and the button so far, and will keep showing up
  on anything else PatternFly renders with its default validation/hover
  border layer.

**To verify after editing `login.css`**: `docker-compose.yml` sets
`KC_SPI_THEME_CACHE_THEMES: "false"`, so editing the file and reloading
`http://localhost:8082/realms/thermometer/protocol/openid-connect/auth?...`
(or clicking "Sign in with Keycloak" from the app) shows the change
immediately — no container restart. PatternFly's exact `.pf-v5-c-*` class
names have moved between Keycloak releases before; if a future image bump
silently drops the styling, inspect the rendered login page's DOM (`curl`
the auth endpoint with a valid PKCE challenge, or view-source in a real
browser) rather than guessing selectors from memory — that's how the
bugs above were actually found and fixed, not by inspection of a
screenshot alone.

## §8. Accessibility & print

- Status is always color + icon + text (§1), never color alone.
- All motion respects `prefers-reduced-motion`.
- `@media print` (`fe/src/index.css`) forces a light, high-contrast token
  set regardless of the active theme (so a dark-mode user printing the
  doctor's clinical report doesn't get white text on white paper), hides
  chrome (`nav`, `.no-print`), and forces tier-band/status-pill fills to
  print (`print-color-adjust: exact`) since they carry meaning.
- Every interactive element must show a visible focus indicator —
  `shadow-focus` in the app, the equivalent teal ring in `login.css` (§7).
