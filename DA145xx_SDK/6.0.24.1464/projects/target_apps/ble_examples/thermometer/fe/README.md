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
- **Component kit**: `src/components/ui/` — `Button`, `Card`, `Input`,
  `Badge`/`TemperatureBadge`/`ConnectionBadge`, `StatCard` (the hero live
  reading), `Table` primitives, `EmptyState`/`SkeletonBlock`/`ErrorState`,
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
`PatientReportPage`'s private `ReportChart`, a fixed 720×260 px chart with no
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
  one-command `docker compose up`.

## Build

```bash
npm install
npm run build     # tsc -b (typecheck) && vite build -> dist/
```

## Run (local dev server)

```bash
cp .env.example .env.local   # defaults already point at localhost:8080 / :9001
npm run dev                  # http://localhost:5173, hot reload
```

Requires the backend (`localhost:8080`) and Mosquitto's WebSocket listener
(`localhost:9001`) to be reachable — start them via
`docker compose up mosquitto postgres backend` from the `thermometer/` root
(see `../README.md`).

## Test

```bash
npm test          # vitest run
npm run test:watch
```

| Suite | What it covers |
|-------|-----------------|
| `src/ble/ieee11073.test.ts` | Pins the exact decode behavior (mantissa × 10^exponent, signed 24-bit mantissa, signed 8-bit exponent) so a future refactor can't silently reintroduce the bug the vendor app has |
| `src/ble/simulatedBluetoothTransport.test.ts` | The simulator's connect/reading-cadence/disconnect contract (fake timers, no real waiting) |
| `src/auth/oidc.test.ts` | `primaryRole()`/`roleOf()` role-priority derivation from a Keycloak `realm_access.roles` claim |
| `src/components/temperatureWindow.test.ts` | The chart's window math — `mergeSeries`, `resolveWindow`'s timestamp→index re-resolution (the live-refetch drift fix), `shiftWindow` clamping, `computeYDomain` padding incl. the °C→°F interval scaling |
| `src/components/trendInsight.test.ts` | The customer trend/digest computation (half-window comparison, highest/lowest, normal-day streak) |
| `src/utils/temperature.test.ts` | °C/°F conversion |
| `src/utils/doctorFeeds.test.ts` | Episode grouping per patient, duration formatting, and the report's reading bucketing |
| `src/pages/admin/dailySeries.test.ts` | Gap-filling a sparse daily-signup series (quiet days must read as zero, not be skipped) |
| `src/pages/admin/rolloutProgress.test.ts` | Rollout installed/failed/pending arithmetic and status→badge mapping |

The pure-logic modules (`temperatureWindow.ts`, `trendInsight.ts`,
`doctorFeeds.ts`, `dailySeries.ts`, `rolloutProgress.ts`) are split out of
their components specifically so this suite can cover them without rendering
anything. Component rendering itself is covered by the Playwright e2e suite
below rather than by jsdom tests.

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

## Docker

```bash
docker build -t thermometer-fe .
docker run -p 8081:80 thermometer-fe
```

Or via `../docker-compose.yml` (`docker compose up fe`), which builds this
image and serves it behind nginx with SPA fallback routing. API/broker/
Keycloak endpoints are baked in at build time via `VITE_API_BASE_URL` /
`VITE_MQTT_WS_URL` / `VITE_KEYCLOAK_URL` build args — see `../docker-compose.yml`.

## What's implemented vs. scaffolded

| Area | Status |
|------|--------|
| Web Bluetooth connect + IEEE-11073 decode | ✅ implemented, tested |
| Simulated BLE transport (no hardware needed) | ✅ implemented, tested — see "Testing without real hardware" above |
| MQTT/WSS publish (primary) + REST upload (fallback) | ✅ implemented |
| Direct MQTT/WSS live subscription | ✅ implemented and wired into the Connect page (`src/live/mqttClient.ts`) |
| Device claim/release + fleet browser (Devices page, custom `DeviceList` rows) — a customer may own several devices, name each one, and see health/staleness per row | ✅ implemented |
| Device naming (`PATCH /api/devices/{bdAddr}/label`) — the customer's name replaces the BD address in the dashboard/history pickers, compare overlays and legends; inline rename on the Devices page, admin-editable in the registry table | ✅ implemented (`utils/devices.ts#deviceDisplayName`, `state/uiStore.ts`) |
| Remembered device selection — Dashboard and History open on the device you last looked at (localStorage via zustand `persist`, revalidated against the owned list on every load so a released device can't be restored) | ✅ implemented (`uiStore.ts` + `utils/devices.ts#resolveSelectedBdAddr`, unit-tested) |
| Dashboard with a charted history (1h/24h/7d range selector) | ✅ implemented — replaces the old bare-table History page |
| Temperature chart: horizontal time scroll (Brush + step buttons), per-window vertical auto-scale, 5 tier bands, multi-series overlay | ✅ implemented (`TemperatureChart.tsx`) — see "Charts" above |
| Role-aware routing/nav (customer/doctor/admin see different pages) | ✅ implemented (`components/RequireRole.tsx`, `components/NavBar.tsx`) |
| Deep-linkable admin sub-routes (`/admin/users`, `/admin/rollouts/:id`, …) | ✅ implemented — replaced local tab state; no `NavBar` change needed, its `/admin` link already matches any sub-path |
| Profile/settings page, incl. customer's doctor-consent management | ✅ implemented |
| Doctor view: patient list + read-only chart per consenting patient | ✅ implemented (`PatientsPage.tsx`) |
| Doctor dashboard: fleet stats, fever alert banner, search/filter/sort, per-patient sparkline + range-scoped avg/min/max, staleness, click-through to Patients | ✅ implemented (`DoctorDashboardPage.tsx`, backend `GET /api/doctor/patients/summary`) |
| Admin view: all users/devices/relationships, force-release, edit device | ✅ implemented |
| Keycloak login | ✅ implemented as the real production flow — standard OAuth2 Authorization Code + PKCE redirect into Keycloak's own hosted login page (`src/auth/oidc.ts`, `oidc-client-ts`/`react-oidc-context`), not a password form owned by this app. |
| Persistent session (survives page reload), proactive token refresh, server-side logout | ✅ implemented — `oidc-client-ts`'s `UserManager` persists the refresh token (localStorage) and its `automaticSilentRenew` redeems a fresh access token before it expires or on reload, so the user stays signed in until Keycloak's SSO session actually ends (expiry, explicit logout, or an admin revoking the session), not merely until the tab is refreshed. `signoutRedirect()` ends the Keycloak SSO session server-side, not just local state. |
| Password change | ✅ implemented — redirects into Keycloak's own `kc_action=UPDATE_PASSWORD` required-action form (Settings page → "Change password"), the same mechanism its Account Console uses. No password ever passes through this app's code. |
| Forgot password | ✅ implemented — Keycloak's own built-in "Forgot password?" link on its login page (`resetPasswordAllowed` in `deploy/keycloak/realm-export.json`), no app code needed; reset emails go through the local `mailpit` SMTP catcher (http://localhost:8025) so the flow is genuinely testable, not just theoretical. |
| Offline buffering (IndexedDB) | ⏸ not implemented — architecture v2 §5 calls for this; readings are only durable while the browser tab is open and connected. |
| Route-based code splitting | ⏸ not implemented — `npm run build` emits a single ~1.26 MB JS chunk (~360 kB gzipped) and warns about it, so every role downloads every other role's pages. Tracked as `../proposals.md` 10.3. |

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
├── ble/
│   ├── ieee11073.ts                  Ported decode/encode — pure, framework-agnostic
│   ├── ieee11073.test.ts             Pins the correct decode behavior
│   ├── BleTransport.ts               Shared interface (also implemented in ../mobile)
│   ├── webBluetoothTransport.ts      Web Bluetooth implementation
│   ├── nativeBluetoothTransport.ts   Capacitor native BLE implementation
│   ├── simulatedBluetoothTransport.ts No-hardware-needed implementation, see above
│   └── createBleTransport.ts         Picks web vs. native at runtime (not simulated — that's an explicit UI choice)
├── auth/
│   ├── oidc.ts                       oidc-client-ts UserManager (Authorization Code + PKCE against Keycloak) —
│   │                                  role derivation from realm_access.roles, sync token/subject getters for
│   │                                  non-React modules, redirectToChangePassword() (kc_action=UPDATE_PASSWORD)
│   └── oidc.test.ts                  Pins primaryRole()/roleOf()'s role-priority logic
├── api/
│   ├── client.ts                     REST client (fetch wrapper, attaches the access token; 401 → one
│   │                                  signinSilent() retry before giving up) + every response/request type.
│   │                                  Paginated endpoints return PageResponse<T> — a stable {content, page,
│   │                                  size, totalElements, totalPages} envelope with a ZERO-based `page`
│   │                                  (the Pagination component is 1-based, so pages need the ±1)
│   ├── queries.ts                    TanStack Query hooks. Polling cadence is per data shape: live readings
│   │                                  5 s, doctor fleet 10 s, fever episodes/rollout progress 30–60 s,
│   │                                  thresholds/notes/audit feeds on demand, admin analytics 5 min.
│   │                                  Note: useDevices() has no refetchInterval — see ../proposals.md 10.7
│   └── useMeasurementHistories.ts    Parallel useQueries fetch for the multi-device overlay; deliberately reuses
│                                      useMeasurementHistory's ['measurements', bdAddr, timeWindowKey(window)] key
│                                      so the cache is shared
├── components/
│   ├── NavBar.tsx                    Role-aware nav: bottom tabs (customer/mobile) or top bar + drawer (doctor/admin/mobile)
│   ├── RequireRole.tsx               Route guard reading the derived role from react-oidc-context's useAuth()
│   ├── TemperatureChart.tsx          recharts chart with a Brush-driven scrollable time window and a Y domain
│   │                                  computed from the visible window; tier bands from TEMPERATURE_TIER_BANDS;
│   │                                  an `annotations` prop marks each reading note's anchor instant on the line
│   ├── temperatureWindow.ts          Window state as timestamps (not Brush indices) + re-resolution to indices
│   │                                  each render — the live-refetch drift fix (see temperatureWindow.test.ts)
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
│   ├── Sparkline.tsx                 Minimal inline-SVG trend line — doctor dashboard's per-patient row, not recharts (one chart per row would be overkill)
│   └── ui/                           Design-system component kit — see "Design system" above. Beyond the base kit:
│                                      Timeline (event feeds, 6 call sites), Pagination (1-based over the API's
│                                      0-based PageResponse), ProgressBar, TrendChart (small admin metric chart),
│                                      DeviceList (card rows for owned/available devices: icon tile, mono
│                                      bd-addr subtitle, badge+meta line, action slot, highlighted state)
├── theme/
│   ├── temperature.ts                getTemperatureTier() + TEMPERATURE_TIER_BANDS — the 5-tier scale, cut points declared once
│   └── chartColors.ts                useChartColors() — theme-aware raw colors for recharts, incl. tierFill and
│                                      seriesPalette (6 fixed validated slots, never cycled)
├── utils/
│   ├── time.ts                       relativeTime() — hoisted so StatCard/dashboards share one granularity
│   ├── temperature.ts                °C/°F conversion
│   ├── temperatureFormat.ts          formatTemperature / formatTemperatureDelta (a delta is an interval, so °F scales ×9/5 without the offset)
│   ├── timeWindow.ts                 TimeWindow ({kind:'sliding',hours} | {kind:'custom',from,to}) + resolve/key/label
│   │                                  helpers — every history query hook takes one instead of a raw rangeHours
│   ├── devices.ts                    deviceDisplayName() (label → model fallback shown everywhere) +
│   │                                  resolveSelectedBdAddr() (remembered-choice reconciliation), unit-tested
│   ├── doctorFeeds.ts                groupByPatient / durationText / bucketReadings — pure shaping for the events feed and report table
│   └── csv.ts                        downloadCsv() — client-side export with a spreadsheet formula-injection guard
├── live/
│   └── mqttClient.ts                 Direct MQTT/WSS publish + live subscribe (mqtt.js)
├── state/
│   ├── store.ts                      Zustand store (connection status, current reading)
│   ├── themeStore.ts                 Zustand store (light/dark/system theme preference, persisted)
│   └── uiStore.ts                    Zustand store (persisted UI prefs: last-selected device bd_addr,
│                                      shared by Dashboard/History/Devices)
└── pages/
    ├── LoginPage.tsx                 Sign-in button → redirects into Keycloak's own hosted login page
    ├── ConnectPage.tsx               Connect (real or simulated), live reading, claim device, live feed
    ├── DashboardPage.tsx             Customer: onboarding, live reading, trend insight, chart (+ multi-device
    │                                  overlay), CSV export, reading notes; opens on the remembered device
    ├── HistoryPage.tsx               Customer: fever-episode timeline (24h / 7d / 30d preset or a custom range)
    ├── DevicesPage.tsx               Customer: owned devices as DeviceList rows (health badge, inline rename,
    │                                  release each) + available fleet (claim more); highlights the row the
    │                                  dashboard is currently showing
    ├── SettingsPage.tsx              All roles: profile + password change; customer: thresholds, doctor consent +
    │                                  access history; admin: system-default thresholds
    ├── DoctorDashboardPage.tsx       Doctor: patient-fleet overview — stats, fever alerts, risk sort, sparklines,
    │                                  variability, device-reliability panel
    ├── PatientsPage.tsx              Doctor: consenting patients + chart (deep-linkable via ?patient=<id>), compare
    │                                  mode, per-patient threshold override, care notes
    ├── PatientReportPage.tsx         Doctor: printable clinical report (own fixed-geometry, always-light chart)
    ├── EventsPage.tsx                Doctor: fleet-wide fever-episode feed
    ├── DoctorAuditPage.tsx           Doctor: consent activity + own audit trail
    ├── AdminPage.tsx                 Admin: tab strip over the nested /admin/* routes below
    └── admin/
        ├── AdminUsersPage.tsx        Growth strip, searchable paged user browser, inline role correction
        ├── AdminDevicesPage.tsx      Inventory strip, model/firmware mix, registry, edit + force-release
        ├── AdminRelationshipsPage.tsx  Consent links, integrity warnings, flagged-only view, revoke
        ├── AdminHealthPage.tsx       Ingest health tiles, stall alerts, readings-by-type
        ├── AdminRolloutsPage.tsx     OTA rollout list with progress bars
        ├── AdminRolloutDetailPage.tsx  Rollout detail + per-target status table
        ├── AdminAuditPage.tsx        Filterable audit log + security-anomaly view
        ├── AdminRetentionPage.tsx    Storage/retention estimates + busiest devices
        ├── AdminUi.tsx               StatTile / StatTileGrid / Segmented — shared admin-page primitives
        ├── dailySeries.ts            fillDailySeries() — gap-fills sparse daily counts
        └── rolloutProgress.ts        Installed/failed/pending arithmetic + status→badge mapping
```
