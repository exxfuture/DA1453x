# thermometer-fe

React + TypeScript + Vite web app for the BLE thermometer platform
(architecture v3 — see `../ARCHITECTURE_V3.html` §3/§6/§7). Connects directly
to a `DLG_THRM` device over Web Bluetooth, decodes the IEEE-11073 temperature
characteristic, publishes readings over MQTT/WSS with a REST fallback, and
subscribes directly to the broker for the live feed.

Replaces the Angular app at `../../../../../../../thermometer_fe/` (kept
as-is, superseded) — the IEEE-11073 decode logic here (`src/ble/ieee11073.ts`)
is a byte-for-byte port of that app's proven, correct decode, not a rewrite,
specifically to avoid regressing the exponent-handling bug the vendor
SmartBond app has (see `../README.md`, "Temperature encoding").

## Design system

The UI follows a bespoke, health-oriented design system ("Pine & Ember" —
teal-green primary + warm terracotta accent + warm-neutral grays,
deliberately not a generic SaaS gray/blue look), with full light and dark
themes. It's built directly on Tailwind, not a component library.

**`../DESIGN_SYSTEM.md` is the written reference** — fonts, full type scale,
every color ramp/role token with hex values, spacing/radius/shadow/motion
scales, component variants, and the density rules in §6. It documents the
tokens below rather than duplicating them as a separate source of truth; if
you change a token here, update that doc in the same pass — it also covers
keeping the Keycloak login theme (`../deploy/keycloak/themes/thermometer/`)
in sync, which this README's summary below doesn't.

- **Tokens**: `tailwind.config.js` (`theme.extend` — color roles, type scale
  incl. `hero-1`/`hero-2` for the live-reading numerals, radius/shadow/
  spacing scales) + `src/index.css` (the actual light/dark CSS-variable
  values, self-hosted `@fontsource` font imports — Fraunces for hero
  numerals, Public Sans for UI, IBM Plex Mono for device IDs).
- **Theme switching**: `src/state/themeStore.ts` (zustand + `persist`,
  `theme: 'light' | 'dark' | 'system'`) sets `data-theme` on `<html>`, which
  `tailwind.config.js`'s `darkMode: ['class', '[data-theme="dark"]']` and
  `src/index.css`'s `:root[data-theme='dark']` block key off. Toggle lives in
  the nav (`src/components/ui/ThemeToggle.tsx`).
- **Component kit**: `src/components/ui/` — `Button`, `Card`, `Input`, `Select`,
  `Badge`/`TemperatureBadge`/`ConnectionBadge`, `StatCard` (the hero live
  reading), `StatTile`/`StatTileGrid` (label + big number + hint, the unit every
  analytics strip is built from), `Segmented` (mutually exclusive view switch),
  `Table` primitives, `EmptyState`/`SkeletonBlock`/`ErrorState`,
  `Alert`, `Timeline` (the shape every event/history feed uses),
  `Pagination`, `ProgressBar`, `TrendChart`. Icons are `lucide-react`. The
  latter four were built before the feature pass that needed them, precisely
  so thirty features wouldn't produce six near-identical timeline
  implementations. A 5-tier temperature-status scale
  (`src/theme/temperature.ts`, `getTemperatureTier`) drives the Dashboard's
  hero color/badge and the chart's tooltip — every tier pairs an icon +
  label with its color, never color alone. Chart theming
  (`src/theme/chartColors.ts`) mirrors the CSS variables as plain hex, since
  recharts takes raw color strings, not Tailwind classes.
- **Density, not a different palette**: customer pages are spacious/warm
  (`Card` `density="comfortable"`, `warm` Button variant allowed); doctor/
  admin pages are dense/professional (`density="compact"`, no `warm` Button
  variant, `Table`-dominant) — one coherent system, two registers via
  spacing and copy tone.

### Token-consistency audit (2026-08-07) — the system was already consistent

A pass was made specifically to hunt down "colors sprinkled randomly through
the app". **The premise didn't hold.** A grep of `src/` for raw Tailwind color
utilities outside the token layer found **exactly one** offender:
`RequireRole.tsx`'s hand-rolled `amber-*` denial banner. Everything else —
every page, badge, alert, chart and stat tile — already went through the token
system.

The fix was therefore one line (swap that div for the existing
`Alert status="warning"`, which also brings the right type scale and
`role="status"`), not a redesign. Recorded here so the same false premise
isn't re-raised: **if you are about to start a systemic color cleanup, re-run
the grep first — as of this date there is nothing to clean up.**

The corroborating evidence is that the subsequent 30-feature pass (risk
badges, staleness badges, episode tiers, rollout progress, integrity warnings)
needed **no new tokens** — the four semantic roles (success/warning/danger/
info) and the five temperature tiers covered all of it.

One genuine duplication did surface: `relativeTime()` existed twice
(`StatCard.tsx` and `DoctorDashboardPage.tsx`) with different granularity.
Hoisted to `src/utils/time.ts`, now shared by both plus the device-staleness
widgets.

### Follow-up (2026-09-14): the duplication that WAS there was structural, not chromatic

The code review of 2026-09-14 (`../CODE_REVIEW.html`) confirmed the colour
finding above — "essentially no hard-coded colours" — and then found five real
duplications one level up, in *components and constants* rather than in tokens.
All five are now single-sourced, and the pattern in every case was the same: the
shared thing lived somewhere call sites wouldn't look.

| What was duplicated | Where it lives now |
|---|---|
| `StatTile` (three near-identical implementations: `pages/admin/AdminUi.tsx`, `EventsPage`, `DoctorDashboardPage` — plus a fourth in the clinical report) | `components/ui/StatTile.tsx`, with the union of their props and three numeral sizes |
| The themed `<select>` class string, retyped in six files | `components/ui/Select.tsx`, mirroring `Input`'s API |
| `formatDuration` — three implementations with three signatures (`(hours)`, `(ms)`, `(startMs, endMs)`) and three unit conventions | `utils/time.ts#formatDuration(ms)`; callers convert, and the doctor's feed and the customer's history now word the same episode identically |
| `TIER_ICON`, declared byte-for-byte (comment included) in `HistoryPage` and `EventsPage` | `theme/temperature.ts`, next to `TEMPERATURE_TIER_BANDS` |
| The overlay cap `5`, declared twice under two names for the same reason (the six-slot `seriesPalette`) | `theme/chartColors.ts#MAX_OVERLAY_SERIES`, derived from `seriesPalette.length` |

The structural cause was folder asymmetry: generic components sitting under
`pages/admin/AdminUi.tsx` are not where anyone looks for reusable UI, so the
doctor pages reinvented them. `AdminUi.tsx` is gone — `StatTile` and `Segmented`
moved into `components/ui/`, `largestOf()` into `utils/breakdown.ts` — and the
doctor pages now have their own `pages/doctor/` namespace to match
`pages/admin/`.

### Charts

Three deliberately different chart components, because they answer different
questions:

- **`TemperatureChart.tsx`** — the main one. A recharts `LineChart` with a
  `Brush` for horizontal scrolling through time, plus unconditional
  Earlier/Later step buttons (a `Brush` traveller is awkward on touch and
  unreachable by keyboard, so dragging is never the only way to move). The
  `YAxis` domain is **recomputed from the visible window's** min/max on every
  render with a padding floor, so a fever spike entering the window makes the
  axis zoom to it instead of being flattened by a fixed full-range axis — that
  behavior is the whole point of the component. All five clinical tiers render
  as `ReferenceArea` bands, which recharts clips to the moving domain for
  free. Multiple series overlay via one `<Line>` per series (customer
  multi-device compare, doctor multi-patient compare), colored from
  `seriesPalette` with a **text** legend — identity is never carried by color
  alone.

  **The one detail not to "simplify" away:** window state is a
  `[start, end]` pair of **timestamps**, re-resolved to array indices on every
  render (`components/temperatureWindow.ts`), never raw `Brush` indices.
  `useMeasurementHistory` refetches a rolling range every 5 s, so index 0 is a
  different instant on every tick — an index-only Brush drifts visibly within
  a minute of live use. `temperatureWindow.test.ts` pins this.

  Data is merged into one wide-format row per timestamp with per-series
  accessor `dataKey`s, because recharts' `<Brush>` cannot own its own data —
  the parent chart clones it and overwrites `data`/`startIndex`/`endIndex`, so
  per-line `data` props don't survive.

  Two consequences of that design the call sites have to respect:

  - The zoom window is component state and is **not** reset from props (the
    rolling 5 s refetch changes `series` constantly, so resetting on that would
    fight the user). Every call site that can swap the charted *subject* —
    device dropdown, patient list, overlay selection, and the dashboard's
    1h/24h/7d range buttons — therefore passes a React `key` derived from that
    subject's identity, so switching remounts the chart. Without it, a window
    zoomed into device A's data stays applied, as an absolute time range, to
    device B's (and a range switch appears to do nothing at all).
  - Below **two** rows the chart renders "Not enough readings to plot in this
    range." instead of a plot: a single reading makes `start === end`, i.e. a
    zero-width `XAxis` domain. Reachable right after a device's first-ever
    reading. `ReportChart` applies the same floor.

- **`MeasurementChart.tsx`** — a thin single-series adapter that maps
  `MeasurementResponse[]` into a `TemperatureSeries` and delegates to
  `TemperatureChart`. Kept so call sites that only ever plot one device don't
  have to construct series objects.

- **`ui/TrendChart.tsx`** — a small `AreaChart` for admin metric panels (daily
  signups, and similar). No bands, no brush, no zoom: these plot counts over
  days, where the interaction affordances of the temperature chart would be
  noise.

Plus `Sparkline.tsx`, which is plain inline SVG rather than recharts — one
recharts instance per row of a patient table would be gratuitous — and
`pages/doctor/PatientReportPage`'s private `ReportChart`, a fixed 720×260 px chart with no
`ResponsiveContainer`, no brush, and the light palette (`LIGHT_CHART_COLORS`,
imported from `theme/chartColors.ts` rather than copied) pinned even in dark
mode, because a dark-theme chart prints as a black rectangle.

Tier cut points live in exactly one place (`src/theme/temperature.ts`'s
`TEMPERATURE_TIER_BANDS`); chart colors resolve from the theme in
`src/theme/chartColors.ts`, since recharts takes raw color strings rather than
Tailwind classes. `seriesPalette` is six fixed, contrast- and
colorblind-validated slots that are **not** cycled — a seventh overlaid series
should get its own chart, not a repeated color — and the Pine brand ramp is
deliberately excluded from it (too low-chroma to be a categorical slot), so it
stays the single-series color.

## Prerequisites

- Node.js 20+ and npm
- A Chromium-based browser (Chrome or Edge) to actually use Web Bluetooth —
  Safari and Firefox don't implement it; the rest of the app still works there.
- The backend and broker running — see `../README.md` "Quick start" for the
  one-command `docker compose up`. The broker no longer accepts anonymous
  connections, so the API has to be up for the live feed to work at all: the app
  mints its broker credential from it.

## Build

```bash
npm install
npm run build     # tsc -b (typecheck, all three tsconfigs) && vite build -> dist/
```

No `VITE_*` variable is needed for a container build any more — the API/broker/
Keycloak URLs are read at *runtime* (see "Runtime configuration" below).

## Run (local dev server)

```bash
cp .env.example .env.local   # defaults already point at localhost:8080 / :9001
npm run dev                  # http://localhost:5173, hot reload
```

Requires the backend (`localhost:8080`) and Mosquitto's WebSocket listener
(`localhost:9001`) to be reachable — start them via
`docker compose up mosquitto postgres backend` from the `thermometer/` root
(see `../README.md`). The broker now requires credentials, which the app mints
for itself through the API — nothing here connects to MQTT anonymously.

The dev login page shows the local realm's demo accounts. That block is behind
`import.meta.env.DEV`, so it exists in `npm run dev` and in **no** build output;
the accounts are also listed in `../README.md`.

## Lint

```bash
npm run lint      # tsc -b --noEmit && eslint .
npm run lint:fix  # eslint . --fix
```

ESLint is a flat config (`eslint.config.js`) with type-aware
`typescript-eslint`, `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`.
It covers `src/`, `e2e/` and the root config files, and the repo currently has
**zero** `eslint-disable` comments — the three that used to sit on
`react-hooks/exhaustive-deps` were suppressing a rule that had never been
installed, and the dependency arrays behind them were fixed instead (the shared
`hooks/useSelectedDevice.ts` is what they turned into). The rules worth knowing
about:

- `no-floating-promises` — fire-and-forget is a real pattern here (a best-effort
  MQTT publish, a `signinRedirect()` from an `onClick`) but has to be spelled
  `void x()` so a genuinely dropped rejection stands out.
- `react-hooks/exhaustive-deps` as an **error**, not a warning.
- `jsx-a11y` recommended, with two documented option tweaks (`<ul role="list">`
  is kept because Safari/VoiceOver drops list semantics under
  `list-style: none`; label nesting depth is raised for the two-line
  label-wraps-checkbox rows).
- `eslint-plugin-react-hooks` v7's React Compiler preview rules (`purity`,
  `set-state-in-effect`, …) are deliberately **not** enabled — see the comment
  in `eslint.config.js` for why that is a separate, deliberate refactor.

## Test

```bash
npm test          # vitest run — jsdom, 19 files / 158 tests
npm run test:watch
```

**Pure logic**

| Suite | What it covers |
|-------|-----------------|
| `src/ble/ieee11073.test.ts` | Pins the exact decode behavior (mantissa × 10^exponent, signed 24-bit mantissa, signed 8-bit exponent) so a future refactor can't silently reintroduce the bug the vendor app has — **plus one case per reserved sentinel** (NaN `0x7FFFFF`, NRes `0x800000`, ±Inf `0x7FFFFE`/`0x800002`), which must decode to `null` rather than to a finite-looking 83886.07 °C, and the adjacent mantissas which must still decode |
| `src/ble/simulatedBluetoothTransport.test.ts` | The simulator's connect/reading-cadence/disconnect contract (fake timers, no real waiting) |
| `src/auth/oidc.test.ts` | `primaryRole()`/`roleOf()` role-priority derivation from a Keycloak `realm_access.roles` claim |
| `src/auth/renewSession.test.ts` | The single-flight silent renewal: N concurrent callers redeem the refresh token **once**, a later 401 starts a fresh attempt, and a failed renewal resolves `false` instead of throwing |
| `src/live/envelope.test.ts` | The wire envelope against `../schema/measurement-envelope.v1.schema.json`, **read from disk** (`ajv` + `ajv-formats`) — the single source of truth shared with the Go gateway and the Java backend. Positive cases plus the rejections: missing fields, an over-long `device_id`, an empty or wrong-shaped payload, a non-finite celsius, a timestamp with no offset |
| `src/components/temperatureWindow.test.ts` | The chart's window math — `mergeSeries`, `resolveWindow`'s timestamp→index re-resolution (the live-refetch drift fix), `shiftWindow` clamping, `computeYDomain` padding incl. the °C→°F interval scaling |
| `src/components/trendInsight.test.ts` | The customer trend/digest computation (half-window comparison, highest/lowest, normal-day streak) |
| `src/utils/temperature.test.ts` | °C/°F conversion |
| `src/utils/doctorFeeds.test.ts` | Episode grouping per patient, duration formatting (now the shared `utils/time.ts#formatDuration`), and the report's reading bucketing |
| `src/pages/admin/dailySeries.test.ts` | Gap-filling a sparse daily-signup series (quiet days must read as zero, not be skipped) |
| `src/pages/admin/rolloutProgress.test.ts` | Rollout installed/failed/pending arithmetic and status→badge mapping |
| `src/utils/devices.test.ts` | `deviceDisplayName()` and `resolveSelectedBdAddr()`'s remembered-choice reconciliation |

**Component / integration (jsdom + `@testing-library/react`)**

Added because the leaks and silent failures below are exactly what no pure-logic
test and no e2e scenario could see: the e2e suite never navigates away while
connected, and never fails an admin mutation.

| Suite | What it covers |
|-------|-----------------|
| `src/pages/ConnectPage.test.tsx` | The transport lifecycle: connect → reading → publish on both paths, explicit disconnect, **disconnect on unmount** (the leak that kept the simulator publishing forever in the background), no double-disconnect, clean unmount with nothing connected, live-feed subscribe/unsubscribe, event rows keyed by identity, claim without a fabricated model, the "Claimed ✓" badge expiring, a failed pairing, and a failed MQTT publish still reaching REST |
| `src/pages/DashboardPage.test.tsx` | Opens on the remembered device, switches device from the picker, and the compare-mode polling gate — the hidden single-device 5 s query must stop while the overlay is open and resume when it closes (verified to fail if the `enabled` flag is removed) |
| `src/pages/admin/AdminDevicesPage.test.tsx` | The admin mutation **failure** paths: a rejected edit keeps the editor open and shows the error, a rejected force-release keeps the confirmation open, the error is dismissible and retryable, and cancelling releases nothing |
| `src/ble/webBluetoothTransport.test.ts` | Listener lifecycle over real `EventTarget` fakes: the notification listener is removed on disconnect, a *cached* characteristic no longer fires on a discarded transport (the duplicate-publish bug), the device listener comes off too, an unexpected GATT drop still reports, and an unsupported browser is refused |
| `src/api/client.test.ts` | Bearer attachment, single 401 → one renewal → retry with the **new** token, four concurrent 401s → **one** renewal, no retry on a non-401, non-JSON error bodies, 204, and the live-credential mint |
| `src/App.test.tsx` | The route table on react-router-dom 7: the lazy doctor and admin chunks resolve behind the shared `Suspense` fallback, each role lands on its own home from `/`, an unknown deep link falls back home, and `RequireRole` refuses a route the role doesn't allow |
| `src/components/NavBar.test.tsx` | Active-link matching on a path **boundary** (`/history-export` must not light up `/history`, while `/admin/rollouts/:id` must still light up `/admin`) and the per-role link set |

The pure-logic modules (`temperatureWindow.ts`, `trendInsight.ts`,
`doctorFeeds.ts`, `dailySeries.ts`, `rolloutProgress.ts`) are still split out of
their components so they can be covered without rendering anything; the
component suites above cover behaviour that only exists once mounted. Full
user journeys across the real stack remain the Playwright suite's job.

`src/test/setup.ts` is the shared jsdom setup (RTL cleanup, `matchMedia`,
`ResizeObserver`, and a working in-memory `Storage` — Node ≥ 24 exposes a
half-implemented global `localStorage` that breaks zustand's `persist`, which is
what the old `NODE_OPTIONS=--no-experimental-webstorage` in the test script was
working around; it is no longer needed).

## Testing without real hardware

`SimulatedBluetoothTransport` (`src/ble/simulatedBluetoothTransport.ts`) is a
third `BleTransport` implementation, alongside Web Bluetooth and the
Capacitor native plugin, that generates synthetic readings instead of
talking to a real device — same drift+noise shape and ~5s cadence as the Go
gateway's `--simulate` mode, and a BD-address-shaped device id (unlike real
Web Bluetooth — see `src/ble/webBluetoothTransport.ts`'s note on why that
matters — this simulator passes the backend's device-claim validation the
same way a gateway-reported MAC would). Click **"Connect (Simulated
Device)"** on the Connect page to exercise the entire app (connect → live
reading → MQTT publish → REST upload → claim → live-feed subscription →
history) with no physical thermometer and no Web Bluetooth support required.

## End-to-end test (real browser, real dockerized backend)

```bash
docker compose -f ../docker-compose.yml up -d   # from ../ — needs the whole stack
npm run test:e2e                                 # Playwright, headless Chromium
```

`e2e/thermometer.spec.ts` drives a real (headless) browser against the
actual `docker compose up` stack — no mocks anywhere in the loop, including
real cross-origin navigation into Keycloak's own hosted login/password
pages (`login()` in the spec file waits for the `localhost:8082` redirect
and drives Keycloak's actual login form, not a page owned by this app).
Four scenarios:

- Ad-hoc connect: logs in as `customer1`, clicks "Connect (Simulated
  Device)", waits for a live reading, claims the device via the real secured
  REST API, waits for the backend's live-feed fan-out over a real MQTT/WSS
  subscription, and confirms a chart renders on the Dashboard. Fails on any
  unexpected browser console error. This is the test that caught two real
  bugs during development: the simulator's non-MAC-shaped id being rejected
  by device-claim validation, and the live-feed handler reading the wrong
  JSON field name (`deviceId` vs. the wire format's `device_id`) — both
  fixed, both now guarded by this test.
- Roles: `customer2` claims one of the always-on simulated fleet devices
  (`docker-compose.yml`'s `gateway-1`..`4`) from the Devices page, grants
  `doctor1` consent from Settings; `doctor1`'s dashboard then lists
  `customer2` as a patient, click-through to a chart works; `admin1` sees
  the user, their device, and the relationship on the Admin page.
- Password change: changes `customer1`'s password via Keycloak's own
  `kc_action=UPDATE_PASSWORD` form (Settings → "Change password"), confirms
  the old password is now rejected and the new one works, then reverts —
  the real end-to-end proof that this app's password-change flow isn't just
  wired up but actually changes the credential Keycloak checks at login.
- Forgot password: triggers Keycloak's built-in "Forgot Password?" flow for
  `admin1`, polls the local `mailpit` SMTP catcher's REST API
  (http://localhost:8025) for the real reset email, follows the reset link
  it contains, sets a new password, confirms it works, then reverts.

The password-change and forgot-password tests grant/claim things they don't
revoke/release on their own success path, and aren't otherwise idempotent
. The two state-dependent scenarios are idempotent against this
persisting database: the "Roles" scenario releases one of customer2's own
devices when no unclaimed fleet device is left (every run claims one, so
this is inevitable after a few runs), falls back to the already-granted
state when customer2 has granted doctor1 before, and its admin-view
assertions use `.first()` to tolerate an account owning several devices.
The password scenarios revert themselves in `finally`. Re-running the suite
back-to-back therefore works without manual cleanup.

## Runtime configuration

The three external endpoints are read **at runtime**, not baked into the bundle,
so one built image is promotable across environments:

| Container env var | What it is | Compose default |
|---|---|---|
| `API_BASE_URL` | Spring Boot API, as the **browser** reaches it | `http://localhost:8080` |
| `MQTT_WS_URL` | Mosquitto's WebSocket listener | `ws://localhost:9001` |
| `KEYCLOAK_URL` | Keycloak base URL (the realm path is appended) | `http://localhost:8082` |

These are the URLs the *browser* calls, so they must be reachable from the user's
machine — never docker-compose service names.

How it works:

1. `docker/20-render-runtime-config.sh` runs from `/docker-entrypoint.d/` before
   nginx starts and writes `/usr/share/nginx/html/env.js`:
   `window.__ENV__ = { API_BASE_URL, MQTT_WS_URL, KEYCLOAK_URL }`. It is served
   with `Cache-Control: no-store`, because a cached `env.js` would point a
   promoted image at the previous environment's API.
2. `index.html` loads `<script src="/env.js">` — an **external** script, so the
   CSP can stay `script-src 'self'` with no nonce or hash. (`dist/index.html` has
   no inline script; that is a property to preserve.)
3. The same script renders `/etc/nginx/conf.d/default.conf` from
   `nginx.conf.template`, substituting the origins it derives from those three
   URLs into the CSP's `connect-src` / `frame-src` / `form-action`.
4. Application code never reads either source directly: **`src/config/env.ts`**
   is the one helper, resolving
   `window.__ENV__?.X ?? import.meta.env.VITE_X ?? <localhost default>`.

That fallback chain is what keeps the other two consumers working:

- **`npm run dev` / `vite preview`** use `.env.local`'s `VITE_*` vars (see
  `.env.example`). `public/env.js` ships an intentionally **empty**
  `window.__ENV__` so the script tag never 404s and resolution falls through.
- **The Capacitor mobile shell** (`../mobile`) loads `../fe/dist` from the app
  bundle, where there is no server to render `env.js` — so it still needs the
  `VITE_*` vars set at `npm run build` time. See `../mobile/README.md`.

## Security posture

| Concern | Where it stands |
|---|---|
| **Token storage** | The oidc-client-ts user object — access **and refresh** token — lives in `sessionStorage`, never `localStorage`, so it is scoped to one tab and gone when that tab closes. An XSS foothold therefore cannot lift a refresh token that outlives the session. `automaticSilentRenew` still refreshes the access token for as long as the tab is open, so nothing about an *active* session changes. **The trade-off:** a reopened tab (or a browser restart) has no local session and signs in again — which is one redirect, not a password prompt, while Keycloak's own SSO session is still valid. For a health-data app that is the right side of the trade. |
| **Passwords** | Never touched by this app: login, logout, "forgot password" and "change password" are all redirects into Keycloak's own hosted UI (Authorization Code + PKCE). |
| **Demo credentials** | Behind `import.meta.env.DEV`, so they are present in `npm run dev` and absent from every build output. |
| **MQTT** | The broker requires credentials (`allow_anonymous false` + dynamic-security ACLs). `src/live/mqttClient.ts` mints one per user via `POST /api/live/credentials` before connecting, and uses the **server-asserted** `userId` from that response for both the publish topic's user segment and the live subscription — no client-supplied identifier decides what a browser can reach, and the broker ACL enforces the same thing independently. A connection/auth failure re-mints once (a rotated password is the expected cause). Signing out drops the session. |
| **Response headers** | Set by nginx (`nginx-security-headers.conf`, included by every location): CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that denies everything the app doesn't use but **keeps `bluetooth=(self)`** for the Connect page. |
| **CSP** | `default-src 'self'`; `script-src 'self'` (no inline script, no nonce); `style-src 'self' 'unsafe-inline'` (React and recharts set element `style` attributes, which `style-src-attr` blocks otherwise); `connect-src` naming exactly the API, MQTT-WS and Keycloak origins; `frame-src`/`child-src` allowing the Keycloak origin, which oidc-client-ts needs for its silent-renew and session-monitor iframes; `frame-ancestors 'none'`; `object-src 'none'`. |
| **TLS / HSTS** | Not here on purpose — it belongs on the TLS-terminating reverse proxy in front of this container (`../ARCHITECTURE_V3.html` §12). Still not implemented anywhere in the local stack. |
| **Route guards** | `components/RequireRole.tsx` is navigation, not authorisation, and says so: the real boundary is the backend re-deriving the caller's role from the bearer token per endpoint. |

## Docker

```bash
docker build -t thermometer-fe .
docker run --rm -p 8090:8080 \
  -e API_BASE_URL=http://localhost:8080 \
  -e MQTT_WS_URL=ws://localhost:9001 \
  -e KEYCLOAK_URL=http://localhost:8082 \
  thermometer-fe
```

- Base image `nginxinc/nginx-unprivileged:1.27-alpine`: the master process runs
  as uid 101, so nginx listens on **8080**, not 80. `../docker-compose.yml` maps
  `8090:8080` — the app's host URL is unchanged at http://localhost:8090.
- There are **no build args**: the URLs above are runtime environment (see
  "Runtime configuration"). Passing `VITE_*` at build time does nothing for the
  container.
- `HEALTHCHECK` hits `/health` with `wget`. `docker inspect -f
  '{{.State.Health.Status}}' <container>` should read `healthy` within ~30 s.
- Hashed assets under `/assets/` are served `immutable` for a year; `index.html`
  is `no-cache` and `env.js` `no-store`, so a redeployed image is picked up
  immediately.

## What's implemented vs. scaffolded

| Area | Status |
|------|--------|
| Web Bluetooth connect + IEEE-11073 decode | ✅ implemented, tested |
| Simulated BLE transport (no hardware needed) | ✅ implemented, tested — see "Testing without real hardware" above |
| MQTT/WSS publish (primary) + REST upload (fallback) | ✅ implemented — authenticated: `src/live/mqttClient.ts` mints a per-user broker credential via `POST /api/live/credentials` before connecting, and publishes under the server-asserted user id. The broker refuses anonymous connections. |
| Direct MQTT/WSS live subscription | ✅ implemented and wired into the Connect page (`src/live/mqttClient.ts`) — subscribes to `live/{userId}/#` using the id from the minted credential, so the topic is not caller-supplied. mqtt.js is `import()`ed on demand, so only the Connect page downloads it. |
| Measurement-envelope parity with the gateway and backend | ✅ implemented — `src/live/envelope.ts` is the only place an envelope is built, and `envelope.test.ts` validates it against `../schema/measurement-envelope.v1.schema.json` read from disk |
| Device claim/release + fleet browser (Devices page, custom `DeviceList` rows) — a customer may own several devices, name each one, and see health/staleness per row | ✅ implemented |
| Device naming (`PATCH /api/devices/{bdAddr}/label`) — the customer's name replaces the BD address in the dashboard/history pickers, compare overlays and legends; inline rename on the Devices page, admin-editable in the registry table | ✅ implemented (`utils/devices.ts#deviceDisplayName`, `state/uiStore.ts`) |
| Remembered device selection — Dashboard and History open on the device you last looked at (localStorage via zustand `persist`, revalidated against the owned list on every load so a released device can't be restored) | ✅ implemented (`uiStore.ts` + `utils/devices.ts#resolveSelectedBdAddr`, unit-tested) |
| Dashboard with a charted history (1h/24h/7d range selector) | ✅ implemented — replaces the old bare-table History page |
| Temperature chart: horizontal time scroll (Brush + step buttons), per-window vertical auto-scale, 5 tier bands, multi-series overlay | ✅ implemented (`TemperatureChart.tsx`) — see "Charts" above |
| Role-aware routing/nav (customer/doctor/admin see different pages) | ✅ implemented (`components/RequireRole.tsx`, `components/NavBar.tsx`) |
| Deep-linkable admin sub-routes (`/admin/users`, `/admin/rollouts/:id`, …) | ✅ implemented — replaced local tab state; no `NavBar` change needed, its `/admin` link already matches any sub-path |
| Profile/settings page, incl. customer's doctor-consent management | ✅ implemented — `SettingsPage.tsx` is a thin role-driven composition of one section per concern in `pages/settings/`, not a single 461-line module |
| Doctor view: patient list + read-only chart per consenting patient | ✅ implemented (`PatientsPage.tsx`) |
| Doctor dashboard: fleet stats, fever alert banner, search/filter/sort, per-patient sparkline + range-scoped avg/min/max, staleness, click-through to Patients | ✅ implemented (`DoctorDashboardPage.tsx`, backend `GET /api/doctor/patients/summary`) |
| Admin view: all users/devices/relationships, force-release, edit device | ✅ implemented |
| Keycloak login | ✅ implemented as the real production flow — standard OAuth2 Authorization Code + PKCE redirect into Keycloak's own hosted login page (`src/auth/oidc.ts`, `oidc-client-ts`/`react-oidc-context`), not a password form owned by this app. |
| Per-tab session (survives page reload), proactive token refresh, server-side logout | ✅ implemented — `oidc-client-ts`'s `UserManager` keeps the user object (access + refresh token) in **`sessionStorage`**, and its `automaticSilentRenew` redeems a fresh access token before it expires or on reload, so the session lasts as long as the tab does. Deliberately *not* `localStorage`: see "Security posture" for the trade-off. Concurrent 401s share one renewal (`renewSession()`). `signoutRedirect()` ends the Keycloak SSO session server-side, not just local state, and also drops the MQTT broker session. |
| Password change | ✅ implemented — redirects into Keycloak's own `kc_action=UPDATE_PASSWORD` required-action form (Settings page → "Change password"), the same mechanism its Account Console uses. No password ever passes through this app's code. |
| Forgot password | ✅ implemented — Keycloak's own built-in "Forgot password?" link on its login page (`resetPasswordAllowed` in `deploy/keycloak/realm-export.json`), no app code needed; reset emails go through the local `mailpit` SMTP catcher (http://localhost:8025) so the flow is genuinely testable, not just theoretical. |
| Offline buffering (IndexedDB) | ⏸ not implemented — architecture v2 §5 calls for this; readings are only durable while the browser tab is open and connected. |
| Route-based code splitting | ✅ implemented — the doctor and admin routes are `React.lazy()` behind one `Suspense` boundary using the existing loading screen, vendor code is split by change cadence (`react-vendor` / `charts` / `auth` / `mqtt`), and mqtt.js is `import()`ed only when the live feed needs it. The entry chunk is **184 kB (53 kB gzipped)**, down from a single 1.26 MB (362 kB) chunk, and Rollup no longer warns. Customer pages stay statically imported — they are the common case and the landing view. |
| Component tests | ✅ implemented — jsdom + `@testing-library/react` over the connect lifecycle, the dashboard's polling gate, the admin mutation failure paths, the Web Bluetooth listener lifecycle and the API client's 401 handling (see "Test") |
| Linting | ✅ implemented — ESLint flat config with type-aware `typescript-eslint`, `react-hooks` and `jsx-a11y`; `npm run lint` runs the typechecker and it, and there are no `eslint-disable` comments |
| Promotable container image (runtime config) | ✅ implemented — `API_BASE_URL` / `MQTT_WS_URL` / `KEYCLOAK_URL` are read at container start into `/env.js`; no build args (see "Runtime configuration") |
| Security response headers | ✅ implemented — CSP scoped to the three back-end origins, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (bluetooth kept), plus gzip; served by an unprivileged nginx on 8080 with a `/health` HEALTHCHECK |

### Role features (2026-08-07 pass)

Ten capabilities per role. Several deliberately share a page rather than
adding a route — noted per row — to keep the nav from sprawling.

**Customer** (`/dashboard`, `/devices`, `/connect`, `/history`, `/settings`)

| Feature | Status |
|---------|--------|
| Trend + daily-digest insight card ("your average is 0.4 °C higher than the previous 24 hours", highest/lowest, normal-day streak) | ✅ implemented (`TrendInsightCard.tsx`) — computed client-side from data already fetched, no extra request; the two requested capabilities ship as one card rather than two saying similar things |
| Fever-episode history | ✅ implemented (`/history`, `HistoryPage.tsx`) — 24h/7d/30d presets or a custom `from`/`to` range (`TimeWindowPicker.tsx`), per-device, tier + peak + duration + reading count |
| Multi-device overlay comparison (up to 5) | ✅ implemented — `useMeasurementHistories.ts`, shares the single-device query cache key so switching modes costs no refetch |
| CSV export of the selected range | ✅ implemented (`utils/csv.ts`) — RFC-4180 quoting plus a spreadsheet formula-injection guard, which matters because this file exists to be opened in Excel |
| Personal alert thresholds | ✅ implemented (`ThresholdEditor.tsx` on Settings) — with an info alert when a doctor override outranks the personal scale. Fields read as "tier starts at `__°C`" (`normalStartC`/`elevatedStartC`/`feverStartC`/`highFeverStartC`) rather than the old "below `__°C`" phrasing, which read as negated/confusing (e.g. a field literally named "Fever" that actually gated High Fever) |
| Notes anchored to a reading (click a chart point) | ✅ implemented (`ReadingNotes.tsx` + `NoteThread.tsx`) — each note also renders as a small marker on the chart at its anchor instant (`TemperatureChart.tsx`'s `annotations` prop), clickable the same as any other point on the line |
| Device health / staleness badges (Reporting / No recent readings / Offline / No readings yet) | ✅ implemented (`DevicesPage.tsx`) — **battery trend descoped**: no battery telemetry reaches the backend (`../proposals.md` 10.2), and an always-empty battery chart would be worse than none |
| Doctor-access transparency (consent grant/revoke history) | ✅ implemented — collapsible section on Settings, with explicit copy that individual reads are *not* tracked, which is what the audit log actually contains |
| Onboarding checklist (claim → first reading → share with a doctor) | ✅ implemented (`OnboardingChecklist.tsx`) — derived from cached queries, dismissible, auto-hides at 3/3 |

**Doctor** (`/dashboard`, `/patients`, `/patients/:patientId/report`, `/events`, `/audit`, `/settings`)

| Feature | Status |
|---------|--------|
| Risk ranking + sort (Risk / Most sick / Most recent / Name) | ✅ implemented (`PatientTriage.tsx`) — risk is the default sort, since alphabetical is the one ordering carrying no clinical information |
| Fleet-wide fever-episode feed | ✅ implemented (`/events`, `EventsPage.tsx`) — tier filter, search, patient chips, incremental paging |
| Variability (± stddev) + trend direction arrows | ✅ implemented — stddev comes from one added `STDDEV_POP` in the existing summary query, no extra round trip |
| Printable clinical report | ✅ implemented (`/patients/:patientId/report`) — `window.print()` + `@media print`, no PDF dependency; its chart is fixed-geometry and always light-palette, because a dark-theme chart prints as a black rectangle |
| Consent activity | ✅ implemented — a section of `/audit` (merged with the audit trail below); see `backend/README.md` "Known gaps" for why the dedicated `consent-activity` endpoint is empty and the audit-log view is the one carrying the data |
| Care notes per patient | ✅ implemented — **doctor-private by design**, labelled as such in the UI; admin has a read-only compliance view, patients have no read path (`../proposals.md` 10.6) |
| Multi-patient overlay compare (up to 5) | ✅ implemented (`PatientsPage.tsx`) |
| Per-patient threshold override | ✅ implemented — shows what the effective scale currently inherits from, so it's clear what's being overridden |
| Own audit trail | ✅ implemented (`/audit`, `DoctorAuditPage.tsx`) — worded by actor-vs-subject, UUIDs resolved to patient names |
| Device-reliability panel | ✅ implemented — replaces the previous frontend-side staleness guess with the server's `stale` flag, so one heuristic exists instead of one per page |

**Admin** (`/admin/*`, `/settings`)

| Feature | Status |
|---------|--------|
| Ingest health + stall alerts | ✅ implemented (`/admin/health`) — auto-refreshes every 60 s; the first place to look when "the app shows no data" |
| Device inventory stats + model/firmware mix | ✅ implemented (`/admin/devices`) |
| OTA rollout list + detail | ✅ implemented (`/admin/rollouts`, `/admin/rollouts/:id`) — progress bars, per-target status filter, and a danger alert when the failure rate passes the rollout's own abort threshold |
| User growth stats (per-role totals + 90-day signup trend) | ✅ implemented (`/admin/users`) |
| Filterable audit-log viewer | ✅ implemented (`/admin/audit`) — actor/action/subject/date, server-side AND-combined; the audit log was previously write-only |
| Consent-integrity warnings (orphaned links, overloaded doctors) | ✅ implemented (`/admin/relationships`) — banner + "flagged only" view |
| User search/filter + inline role change | ✅ implemented (`/admin/users`) — debounced server-side search; **local mirror only**, overwritten by Keycloak at next login, and the UI says so (`backend/README.md` "Known gaps") |
| System-default thresholds | ✅ implemented — folded into an admin-only section of Settings rather than a near-empty admin tab |
| Storage & retention insight | ✅ implemented (`/admin/retention`) — row counts labelled as estimates, since `COUNT(*)` on a two-year hypertable is exactly the query that makes an admin page take a minute |
| Security-anomaly summary | ✅ implemented — a second view of `/admin/audit` rather than its own route, since every row in it is a jump into the log; backed by the backend's new `access.denied` audit rows |

## Source layout

```
src/
├── config/
│   └── env.ts                        The ONE reader of API_BASE_URL / MQTT_WS_URL / KEYCLOAK_URL:
│                                      window.__ENV__ (runtime /env.js) ?? import.meta.env.VITE_* ?? localhost
│                                      default. See "Runtime configuration"
├── ble/
│   ├── ieee11073.ts                  Ported decode/encode — pure, framework-agnostic; returns null for a short
│   │                                  buffer AND for the reserved NaN/NRes/±Inf mantissas
│   ├── ieee11073.test.ts             Pins the correct decode behavior + one case per reserved sentinel
│   ├── BleTransport.ts               Shared interface (also implemented in ../mobile)
│   ├── webBluetoothTransport.ts      Web Bluetooth implementation — holds the characteristic so disconnect()
│   │                                  can detach its notification listener
│   ├── webBluetoothTransport.test.ts Listener lifecycle over EventTarget fakes (no hardware)
│   ├── nativeBluetoothTransport.ts   Capacitor native BLE implementation
│   ├── simulatedBluetoothTransport.ts No-hardware-needed implementation, see above
│   └── createBleTransport.ts         Picks web vs. native at runtime (not simulated — that's an explicit UI choice)
├── auth/
│   ├── oidc.ts                       oidc-client-ts UserManager (Authorization Code + PKCE against Keycloak) —
│   │                                  sessionStorage user store (per-tab tokens), role derivation from
│   │                                  realm_access.roles, a sync getAuthToken() for non-React modules (and
│   │                                  deliberately no subject getter — see FE-03), single-flight
│   │                                  renewSession(), redirectToChangePassword()
│   ├── oidc.test.ts                  Pins primaryRole()/roleOf()'s role-priority logic
│   └── renewSession.test.ts          Pins the single-flight renewal over a fake UserManager
├── api/
│   ├── client.ts                     REST client (fetch wrapper, attaches the access token; 401 → ONE shared
│   │                                  renewSession() retry before giving up) + every response/request type,
│   │                                  incl. LiveCredentialsResponse. Paginated endpoints return PageResponse<T>
│   │                                  — a stable {content, page, size, totalElements, totalPages} envelope with
│   │                                  a ZERO-based `page` (the Pagination component is 1-based, so pages need ±1)
│   ├── client.test.ts                Bearer attachment, the 401 retry, and the concurrent-401 de-duplication
│   ├── queries.ts                    TanStack Query hooks. Polling cadence is per data shape: live readings
│   │                                  5 s, doctor fleet 10 s, fever episodes/rollout progress 30–60 s,
│   │                                  thresholds/notes/audit feeds on demand, admin analytics 5 min.
│   │                                  useMeasurementHistory/useResolvedThresholds take an `enabled` option, so a
│   │                                  caller showing nothing stops polling (Dashboard compare mode) and a
│   │                                  patient-scoped read can't silently answer for the caller instead.
│   │                                  Note: useDevices() has no refetchInterval — see ../proposals.md 10.7
│   └── useMeasurementHistories.ts    Parallel useQueries fetch for every multi-device/multi-patient overlay;
│                                      deliberately reuses useMeasurementHistory's
│                                      ['measurements', bdAddr, timeWindowKey(window)] key so the cache is shared
├── hooks/
│   ├── useSelectedDevice.ts          Remembered + revalidated device choice, shared by Dashboard and History
│   │                                  (replaces the duplicated effect pair in both)
│   └── useTransientFlag.ts           Turns a latched mutation isSuccess into a "✓" that expires
├── components/
│   ├── NavBar.tsx                    Role-aware nav: bottom tabs (customer/mobile) or top bar + drawer
│   │                                  (doctor/admin/mobile); active link matches on a path boundary, and
│   │                                  signing out closes the MQTT session first
│   ├── RequireRole.tsx               Route guard reading the derived role from react-oidc-context's useAuth().
│   │                                  Navigation, NOT authorisation — the header comment cross-references the
│   │                                  server-side enforcement that is the real boundary
│   ├── TemperatureChart.tsx          recharts chart with a Brush-driven scrollable time window and a Y domain
│   │                                  computed from the visible window; tier bands from TEMPERATURE_TIER_BANDS;
│   │                                  an `annotations` prop marks each reading note's anchor instant on the line
│   ├── temperatureWindow.ts          Window state as timestamps (not Brush indices) + re-resolution to indices
│   │                                  each render — the live-refetch drift fix (see temperatureWindow.test.ts).
│   │                                  computeYDomain binary-searches to the window's edges instead of scanning
│   │                                  every point of every series
│   ├── MeasurementChart.tsx          Single-series adapter over TemperatureChart (MeasurementResponse[] -> series)
│   ├── TimeWindowPicker.tsx          Preset (1h/24h/7d/...) + "Custom" datetime-local range control, shared by
│   │                                  DashboardPage and HistoryPage
│   ├── ThresholdEditor.tsx           Scope-aware tier-scale form (system / customer / doctor-override) — fields
│   │                                  read as "tier starts at __°C", not "below __°C"
│   ├── NoteThread.tsx                Composer + note list, shared by reading annotations and care notes
│   ├── ReadingNotes.tsx              Customer annotation card — anchors a note to a clicked chart instant (or a
│   │                                  clicked chart-marker for an existing note)
│   ├── TrendInsightCard.tsx          Customer trend + digest card (renders computeTrendInsight's output)
│   ├── trendInsight.ts               Pure half-window comparison / highest / lowest / normal-day-streak math
│   ├── OnboardingChecklist.tsx       3-step getting-started card, localStorage-dismissible
│   ├── PatientTriage.tsx             RiskBadge / RISK_RANK / TrendArrow — shared by fleet table, detail pane, report
│   ├── Sparkline.tsx                 Minimal inline-SVG trend line — doctor dashboard's per-patient row, not
│   │                                  recharts (one chart per row would be overkill). The SVG is aria-hidden, so
│   │                                  a `label` prop is REQUIRED and rendered sr-only
│   └── ui/                           Design-system component kit — see "Design system" above. Beyond the base kit:
│                                      Timeline (event feeds, 6 call sites), Pagination (1-based over the API's
│                                      0-based PageResponse), ProgressBar, TrendChart (small admin metric chart),
│                                      DeviceList (card rows for owned/available devices), Select (the themed
│                                      native <select>, mirroring Input's API — six call sites used to retype its
│                                      class string), StatTile/StatTileGrid (label + big number + hint, three
│                                      sizes; there used to be four copies of this), Segmented (mutually
│                                      exclusive view switch — moved out of pages/admin/ because it is generic)
├── theme/
│   ├── temperature.ts                getTemperatureTier() + TEMPERATURE_TIER_BANDS — the 5-tier scale, cut points
│   │                                  declared once — plus TIER_LABEL and TIER_ICON (the lucide icon per tier,
│   │                                  which HistoryPage and EventsPage each used to declare for themselves)
│   └── chartColors.ts                useChartColors() — theme-aware raw colors for recharts, incl. tierFill and
│                                      seriesPalette (6 fixed validated slots, never cycled) + MAX_OVERLAY_SERIES,
│                                      derived from the palette rather than restated per overlay page
├── utils/
│   ├── time.ts                       relativeTime() ("how long ago") + formatDuration(ms) ("how long") — one
│   │                                  elapsed-time convention where there used to be three signatures
│   ├── temperature.ts                °C/°F conversion
│   ├── temperatureFormat.ts          formatTemperature / formatTemperatureDelta (a delta is an interval, so °F scales ×9/5 without the offset)
│   ├── timeWindow.ts                 TimeWindow ({kind:'sliding',hours} | {kind:'custom',from,to}) + resolve/key/label
│   │                                  helpers — every history query hook takes one instead of a raw rangeHours
│   ├── devices.ts                    deviceDisplayName() (label → model fallback shown everywhere) +
│   │                                  resolveSelectedBdAddr() (remembered-choice reconciliation), unit-tested
│   ├── doctorFeeds.ts                groupByPatient / durationText / bucketReadings — pure shaping for the events feed and report table
│   ├── breakdown.ts                  largestOf() — the denominator for the admin breakdown bars (the largest row,
│   │                                  never the sum, because every breakdown is server-side capped)
│   └── csv.ts                        downloadCsv() — client-side export with a spreadsheet formula-injection guard
├── live/
│   ├── envelope.ts                   buildTemperatureEnvelope() + WEB_COLLECTOR_ID — the one place a wire envelope
│   │                                  is constructed; the FORMAT lives in ../../../schema/
│   ├── envelope.test.ts              Validates it against that schema file, read from disk (ajv)
│   └── mqttClient.ts                 Direct MQTT/WSS publish + live subscribe. Mints a per-user broker credential
│                                      from POST /api/live/credentials before connecting, uses the server-asserted
│                                      userId for both the publish topic and the subscription, re-mints once on a
│                                      connection/auth failure, and closeLiveSession() drops it on sign-out.
│                                      mqtt.js is import()ed on demand
├── state/
│   ├── store.ts                      Zustand store (connection status, current reading)
│   ├── themeStore.ts                 Zustand store (light/dark/system theme preference, persisted)
│   └── uiStore.ts                    Zustand store (persisted UI prefs: last-selected device bd_addr,
│                                      shared by Dashboard/History/Devices)
├── test/
│   └── setup.ts                      Shared jsdom setup: RTL cleanup, matchMedia/ResizeObserver stubs, and a
│                                      working in-memory Storage (Node's experimental one breaks zustand persist)
└── pages/
    ├── LoginPage.tsx                 Sign-in button → redirects into Keycloak's own hosted login page. The demo
    │                                  accounts are behind import.meta.env.DEV, so they never ship in a build
    ├── ConnectPage.tsx               Connect (real or simulated), live reading, claim device, live feed —
    │                                  disconnects the transport on unmount
    ├── ConnectPage.test.tsx          That lifecycle, plus the publish/claim/live-feed behaviour
    ├── DashboardPage.tsx             Customer: onboarding, live reading, trend insight, chart (+ multi-device
    │                                  overlay), CSV export, reading notes; opens on the remembered device and
    │                                  pauses the single-device poll while the overlay is open
    ├── DashboardPage.test.tsx        The remembered device, the picker, and that polling gate
    ├── HistoryPage.tsx               Customer: fever-episode timeline (24h / 7d / 30d preset or a custom range)
    ├── DevicesPage.tsx               Customer: owned devices as DeviceList rows (health badge, inline rename,
    │                                  release each) + available fleet (claim more); highlights the row the
    │                                  dashboard is currently showing
    ├── SettingsPage.tsx              A thin role-driven composition of ./settings/* — nothing else
    ├── settings/                     One section per concern, each owning its own queries and mutations:
    │   ├── ProfileSection.tsx         Display name + temperature unit (all roles)
    │   ├── PasswordSection.tsx        The Keycloak kc_action=UPDATE_PASSWORD redirect (all roles)
    │   ├── MyThresholdsSection.tsx    Customer's personal alert scale, incl. the doctor-override notice
    │   ├── MyDoctorsSection.tsx       Customer's consent grant/revoke + the collapsible history below
    │   ├── ConsentHistorySection.tsx  That paginated grant/revoke timeline (consent lifecycle, never reads)
    │   └── SystemThresholdsSection.tsx Admin's system-default scale
    ├── doctor/                       The doctor page set, namespaced to match pages/admin/
    │   ├── DoctorDashboardPage.tsx    Patient-fleet overview — stats, fever alerts, risk sort, sparklines
    │   │                              (each with an sr-only summary), variability, device-reliability panel
    │   ├── PatientsPage.tsx          Consenting patients + chart (deep-linkable via ?patient=<id>), compare
    │   │                              mode via the shared useMeasurementHistories hook, per-patient threshold
    │   │                              override, care notes
    │   ├── PatientReportPage.tsx     Printable clinical report (own fixed-geometry, always-light chart); its
    │   │                              patient-scoped threshold read is gated on a real id, and a failed
    │   │                              patient-list fetch renders an error with a retry, not "not found"
    │   ├── EventsPage.tsx            Fleet-wide fever-episode feed
    │   └── DoctorAuditPage.tsx       Consent activity + own audit trail
    ├── AdminPage.tsx                 Admin: tab strip over the nested /admin/* routes below
    └── admin/
        ├── AdminUsersPage.tsx        Growth strip, searchable paged user browser, inline role correction —
        │                              promoting to admin requires an explicit confirm
        ├── AdminDevicesPage.tsx      Inventory strip, model/firmware mix, registry, edit + force-release; both
        │                              mutations close their UI on success only and surface isError
        ├── AdminDevicesPage.test.tsx Those failure paths
        ├── AdminRelationshipsPage.tsx  Consent links, integrity warnings, flagged-only view, revoke
        ├── AdminHealthPage.tsx       Ingest health tiles, stall alerts, readings-by-type
        ├── AdminRolloutsPage.tsx     OTA rollout list with progress bars
        ├── AdminRolloutDetailPage.tsx  Rollout detail + per-target status table
        ├── AdminAuditPage.tsx        Filterable audit log + security-anomaly view
        ├── AdminRetentionPage.tsx    Storage/retention estimates + busiest devices
        ├── dailySeries.ts            fillDailySeries() — gap-fills sparse daily counts
        └── rolloutProgress.ts        Installed/failed/pending arithmetic + status→badge mapping
```

Project-root files worth knowing about:

```
eslint.config.js                Flat ESLint config (see "Lint")
nginx.conf.template             Served config TEMPLATE — the CSP's origins are substituted at container start
nginx-security-headers.conf     The header set, installed as an nginx snippet and included by every location
docker/20-render-runtime-config.sh  Entrypoint: renders env.js + default.conf from the container environment
public/env.js                   Intentionally EMPTY window.__ENV__, so dev/preview/Capacitor don't 404 on it
tsconfig.{app,node,e2e}.json    Three projects — src/, the Vite config, and the Playwright suite (all typechecked
                                by `tsc -b`, which is why `npm run lint` catches e2e drift too)
```
