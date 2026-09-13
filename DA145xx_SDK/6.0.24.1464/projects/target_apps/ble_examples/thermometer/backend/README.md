# thermometer-backend

Spring Boot 3 / Java 21 ingest and API service (architecture v3 §2/§8/§9/§10):
subscribes directly to MQTT for measurements (no separate durable-log tier —
QoS 1 + ack-after-commit is the durability mechanism), stores them in
TimescaleDB, and exposes a REST API for device registry, measurement
history, and DIY OTA rollout orchestration.

## Prerequisites

- JDK 21+ (built and tested here on Java 26/Corretto; `maven.compiler.release`
  is pinned to 21 so the *output* targets 21 regardless of which JDK builds it)
- Maven 3.9+
- Docker (for the Testcontainers integration test, and for running the infra
  this service depends on)

## Build

```bash
mvn compile
```

## Test

```bash
mvn test      # unit tests only — no Docker needed, ~1s
mvn verify    # unit tests + the Testcontainers integration test (needs Docker)
```

`mvn verify` spins up **real** Mosquitto and TimescaleDB containers and
proves the whole ingest path end-to-end: a message published over MQTT is
picked up by the real `MqttIngestSubscriber`, written to Postgres, and comes
back out through the REST history endpoint — plus a dedup test confirming a
redelivered reading doesn't create a duplicate row, and a live-feed test
confirming a claimed device's readings are fanned out to its owner's
`live/{user_id}/...` topic. See
`src/test/java/com/dialog/thermometer/it/IngestPipelineIT.java`.

Test breakdown:

| Class | What it covers |
|-------|-----------------|
| `MeasurementEnvelopeTest` | Envelope JSON parsing/validation |
| `RolloutServiceTest` | Percentage-bucket determinism/monotonicity, version comparison |
| `RateLimitFilterTest` | Which bucket a request charges (blanket vs. collector-endpoint, collector charged first), per-caller isolation, the 429 body/`Retry-After` shape, `/actuator/health` exemption, and `X-Forwarded-For` being ignored unless trusted |
| `IngestPipelineIT` | Real MQTT → Postgres → REST, redelivery dedup, and live-feed fan-out (Testcontainers) |
| `RbacIT` | The whole authorization matrix, driven through real controller methods: claim/release exclusivity, role rejections, consent-gated measurement access, owner-only measurement **upload**, enumeration-safe consent revoke (404 not 403), admin listings, doctor dashboard summary — plus threshold scoping and resolution precedence, event feeds (device-scoped and fleet-wide), annotation authorship, care-note privacy, admin analytics/role-change guards, and the rollout collector token (Testcontainers) |
| `RolloutCollectorTokenIT` | The two OTA collector endpoints over real HTTP: `X-Device-Token` accepted/rejected with no JWT involved, `/pending` not shadowed by the `/{id}` detail mapping, and `RateLimitFilter` actually registered in the servlet chain (429 + `Retry-After`, health still exempt) |

Both IT classes start their own Postgres/Mosquitto containers, so they are
independent of each other and of execution order.

## Run

Two ways, matching the two Spring profiles:

**Against infra started by `../docker-compose.yml`, backend on the host JVM**
(fastest inner loop; security disabled for convenience):

```bash
docker compose -f ../docker-compose.yml up -d mosquitto postgres
mvn spring-boot:run    # active profile defaults to `local` — see application.yml
```

**Fully containerized, matching the real architecture** (Keycloak-secured):

```bash
docker compose -f ../docker-compose.yml up backend
# -> requires a Keycloak-issued JWT for anything but /actuator/health. There's
#    no curl-able password grant anymore (see "Roles & identity" below) — the
#    easiest way to get one is to log into the fe app in a browser and copy
#    `access_token` out of the `oidc.user:...` entry in devtools' localStorage.
```

## Configuration

| Profile | When | Security | Datasource / broker host |
|---------|------|----------|---------------------------|
| `local` (default — see `spring.profiles.default` in `application.yml`) | `mvn spring-boot:run` on the host | disabled (`thermometer.security.enabled=false`) | `localhost` |
| `docker` | running inside `docker-compose.yml` | enabled, validates Keycloak JWTs | compose service names (`postgres`, `mosquitto`, `keycloak`) |

Key settings (`application.yml` / `application-{profile}.yml`):

| Property | Purpose |
|----------|---------|
| `spring.threads.virtual.enabled` | Virtual threads for request handling (architecture v3 §2.1) |
| `thermometer.mqtt.broker-url` | Mosquitto/EMQX connection string |
| `thermometer.security.enabled` | Toggles the two `SecurityConfig` filter chains |
| `thermometer.oidc.jwk-set-uri` | Where this container fetches Keycloak's signing keys (docker profile only) — see "Roles & identity" for why it's split from `issuer-uri` |
| `thermometer.oidc.issuer-uri` | The externally-visible issuer string every token's `iss` claim must equal (docker profile only) |
| `thermometer.cors.allowed-origins` | Origins allowed to call the API from a browser |
| `thermometer.device.collector-token` | Shared `X-Device-Token` secret for the two OTA collector endpoints |
| `thermometer.ratelimit.enabled` | Master switch for `RateLimitFilter` (default `true`) — see "Rate limiting" below |
| `thermometer.ratelimit.trust-forwarded-for` | Whether `X-Forwarded-For` identifies the caller (default `false` — nothing fronts the backend in the shipped compose stack); set `true` only behind a proxy that overwrites the header |
| `thermometer.ratelimit.default.requests-per-minute` / `.default.burst` | Blanket per-caller budget (defaults `240` / `80`) |
| `thermometer.ratelimit.rollout.requests-per-minute` / `.rollout.burst` | Tighter budget for the two OTA collector endpoints (defaults `10` / `10`) |

## API surface (MVP)

Role checks are enforced in-app (`CurrentUserService` + explicit checks in each
controller), not via Spring's `@PreAuthorize`/`hasRole()` — see "Roles &
identity" below for why. The one exception is `/actuator/**`, which Spring
handles before any controller exists; see "Device & operator authentication".

Endpoints marked **paged** accept Spring's `page`/`size`/`sort` query params
and return a `PageResponse<T>` envelope (see "Pagination" below); the rest
return a plain object or list.

### Identity & profile

| Endpoint | Purpose | Role |
|----------|---------|------|
| `GET /api/me` | Current user's profile (JIT-provisions the local `users` row) | any |
| `PATCH /api/me` | Update own display name + preferred temperature unit | any |

### Devices

| Endpoint | Purpose | Role |
|----------|---------|------|
| `POST /api/devices/{bdAddr}/claim` | Claim a device (409 if already owned by someone else; a customer may own several) | customer |
| `POST /api/devices/{bdAddr}/release` | Release own device | customer |
| `PATCH /api/devices/{bdAddr}/label` | Rename own device (customer-set friendly name shown instead of the BD address; blank clears). Owner-scoped **in the query** — anyone else gets an indistinguishable 404, same rule as consent revocation. Audited as `device.rename`. | owner only |
| `GET /api/devices/available` | List unclaimed devices | customer |
| `GET /api/devices` | Role-branched: own devices / consenting patients' devices / all. Each `DeviceResponse` carries `label`, `lastSeenAt`/`lastSeenType` | customer, doctor, admin |

### Consent & doctor access

| Endpoint | Purpose | Role |
|----------|---------|------|
| `GET /api/doctors` | List doctors (to grant consent to) | customer, admin |
| `POST /api/consents` | Grant a doctor access to own data (idempotent) | customer |
| `DELETE /api/consents/{id}` | Revoke a consent link — anyone else (including the doctor it points at) gets **404**, not 403 | customer (own), admin (any) |
| `GET /api/consents` | Role-branched: own links (incl. revoked) / active links to self / all | customer, doctor, admin |
| `GET /api/consents/access-history` | **paged** — own consent grant/revoke history | customer |
| `GET /api/doctor/patients` | Consenting patients + their device summary | doctor |
| `GET /api/doctor/patients/summary` | Doctor dashboard: per-patient latest/avg/min/max/stddev/count/sparkline plus `riskScore`/`riskTier`/`stale` (`?rangeHours=`, default 24) | doctor |
| `GET /api/doctor/consent-activity` | **paged** — consent actions with *this doctor as actor*. Empty by design, see below | doctor |
| `GET /api/doctor/audit-log` | **paged** — everything with this doctor as actor **or** subject | doctor |

### Measurements & derived events

| Endpoint | Purpose | Role |
|----------|---------|------|
| `POST /api/measurements` | REST fallback upload (primary path is MQTT — v2 §5.2). Owner-only write, see below | customer (own or unclaimed device) |
| `GET /api/measurements/{deviceId}` | History query (`?type=&from=&to=&limit=`, default 500, capped 5000) | via `DeviceAccessGuard` |
| `GET /api/events/device/{bdAddr}` | Threshold-crossing episodes for one device (`?from=&to=`, default last 7 d, max span 90 d) | via `DeviceAccessGuard` |
| `GET /api/events/patients` | Fleet-wide episode feed, one entry per patient × device | doctor |

Episodes are derived **on read** from the `measurements` hypertable — there is
no events table, so a threshold change re-tiers history automatically
(`event/TemperatureEventService`).

**Who may upload.** `POST /api/measurements` is a *browser-collector* endpoint,
not a headless-device one: its real caller is `fe/src/pages/ConnectPage.tsx`
uploading readings it just took over Web Bluetooth, with the user's Keycloak
JWT attached — so it authenticates as a person and is authorized like one, via
`DeviceAccessGuard.requireIngestAccess`:

- **customer** — may upload only for a device they own, or for one **nobody**
  owns yet;
- **doctor / admin** — rejected outright. A reading is something a device
  produced; nobody submits one on a patient's behalf. Consent grants a doctor
  *read* access and must not become a write path.

The rule is stricter than the read rule on purpose. An injected reading is not
just a wrong point on a chart: it feeds episode detection and the doctor
dashboard's `riskScore`/`riskTier` triage, so a fabricated 41 °C tagged with
someone else's `bd_addr` can misdirect clinical attention.

Unclaimed devices stay writable because that is the only way one becomes
claimable — `MeasurementIngestService` registers an unknown `bd_addr` on its
first reading, which is what puts it in `GET /api/devices/available`, and the
browser starts uploading the moment it connects, before the user clicks
"claim". The residual risk (a customer can seed readings for an address nobody
has claimed, which whoever later claims it would then see) is accepted and
tracked with `../proposals.md` 10.1: closing it means collectors
authenticating **as the device**, not as a person.

The MQTT path (`ingest/MqttIngestSubscriber`) is unaffected — it is guarded at
the broker, not here.

### Alert thresholds

Whole-row precedence, most specific wins: `doctor_override` → `self` →
`system` → a hardcoded fallback mirroring `fe/src/theme/temperature.ts`'s tier
boundaries. There is no per-field merge — a stored row replaces the next one
down entirely, so a scale is always internally consistent.

| Endpoint | Purpose | Role |
|----------|---------|------|
| `GET /api/thresholds/resolved` | Effective scale for a subject (`?subjectUserId=`, default self) plus its `source` | customer (self), doctor (consenting patient), admin |
| `GET`/`PUT`/`DELETE /api/thresholds/mine` | Own personal scale (204 when none stored) | customer |
| `GET`/`PUT`/`DELETE /api/thresholds/patient/{patientUserId}` | This doctor's override for a patient; set/clear are audited | doctor (active consent required) |
| `GET`/`PUT /api/thresholds/system` | System default (no `DELETE` — the bottom of the chain always exists) | admin |

### Notes

| Endpoint | Purpose | Role |
|----------|---------|------|
| `POST /api/annotations` | Note anchored to a reading/interval on own device | customer (owner) |
| `GET /api/annotations` | `?deviceBdAddr=` (required) `&from=&to=&limit=` (default 200, max 1000) | via `DeviceAccessGuard` |
| `PATCH`/`DELETE /api/annotations/{id}` | Edit/delete own note — a non-author gets **404**, not 403 | author only |
| `POST /api/care-notes` | Doctor's clinical note on a patient | doctor (active consent required) |
| `GET /api/care-notes` | `?patientUserId=` — this doctor's own notes. Reading does **not** require live consent, so revoking doesn't erase a doctor's record | doctor |
| `PATCH`/`DELETE /api/care-notes/{id}` | Edit/delete own note — another doctor's note is **404** | author only |

Write access is narrower than read access for annotations (owner writes,
anyone who can read the readings can read the note) and the reverse for care
notes (doctor-private, patients cannot read them at all — see "Care-note
visibility" below).

### Admin

| Endpoint | Purpose | Role |
|----------|---------|------|
| `GET /api/admin/users` | **paged** — `?q=` (username/email, case-insensitive) `&role=`; device + active-consent counts enriched for the current page only | admin |
| `PATCH /api/admin/users/{id}` | Change the **local mirror's** role; 400 on self (lockout guard) or unknown role. Audited | admin |
| `GET /api/admin/consents` | **paged** — all consent links, enriched with usernames | admin |
| `GET /api/admin/audit-log` | **paged** — `?actorId=&action=&subject=&from=&to=` (AND-combined) | admin |
| `GET /api/admin/care-notes` | `?patientUserId=` (required) `&doctorUserId=` — read-only compliance view | admin |
| `POST /api/admin/devices/{bdAddr}/release` | Force-release any device | admin |
| `PATCH /api/admin/devices/{bdAddr}` | Edit device model/fwVersion/label | admin |

### Admin analytics

All read-only, all admin, all raw `JdbcTemplate` with per-group rows capped at
100.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/analytics/ingest` | Readings + reporting devices over the last hour/day, plus a per-`type` day breakdown |
| `GET /api/admin/analytics/device-inventory` | Total/claimed/unclaimed/still-reporting (from `devices.last_seen_at`) + model × firmware mix |
| `GET /api/admin/analytics/user-growth` | Users per role + 90-day daily signups |
| `GET /api/admin/analytics/consent-integrity` | Active links, links pointing at deleted users, doctors over `?doctorPatientThreshold=` (default 50) |
| `GET /api/admin/analytics/retention` | Hypertable footprint + busiest devices over 30 days — row counts are **`pg_class.reltuples` estimates**, deliberately not `COUNT(*)` on a hypertable holding two years of readings |
| `GET /api/admin/analytics/security-ops` | 24 h anomaly summary over the `access.denied` audit rows: denial counts, repeated actions past `?threshold=` (default 50), most-denied actors |

### OTA rollouts

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `POST /api/rollouts` | Create a DIY OTA rollout | admin (JWT) |
| `GET /api/rollouts` | **paged** — rollout list with batched installed/failed/pending counts | admin (JWT) |
| `GET /api/rollouts/{id}` | Rollout + per-target detail | admin (JWT) |
| `GET /api/rollouts/pending` | Collector check-in: `?chipModel=&bdAddr=&currentVersion=`; 204 when there's nothing to install | **`X-Device-Token`**, no JWT |
| `POST /api/rollouts/{id}/status` | Collector reports install success/failure | **`X-Device-Token`**, no JWT |

### Pagination

Paged endpoints return a hand-rolled envelope rather than Spring Data's
`Page<T>`:

```json
{ "content": [ … ], "page": 0, "size": 25, "totalElements": 137, "totalPages": 6 }
```

`Page<T>`'s serialized form is unstable across Boot versions and leaks
`Pageable`/`Sort` internals into the client contract; `PageResponse` is five
fields that won't change under the frontend. `page` is **zero-based** (the
frontend's `Pagination` component is 1-based and does the ±1).

Not everything is paged, on purpose: `GET /api/measurements/{deviceId}`'s
`from`/`to`/`limit` is the right shape for a time series, and low-volume
user-authored tables (annotations, care notes) use the same bounded-`limit`
style rather than page numbers.

## Authentication (FR-7)

Login, logout, password change, and forgot-password are handled entirely by
Keycloak's own hosted UI via standard OAuth2 Authorization Code + PKCE
(`fe/src/auth/oidc.ts`, `oidc-client-ts`/`react-oidc-context`) — this backend
never sees a raw credential and has no password-related endpoint. The
`thermometer-web` client (`deploy/keycloak/realm-export.json`) has
`directAccessGrantsEnabled: false` (no resource-owner-password grant) and
requires PKCE; changing a password redirects into Keycloak's
`kc_action=UPDATE_PASSWORD` required-action form, and "forgot password" uses
Keycloak's built-in `resetPasswordAllowed` flow (realm's `smtpServer` points
at the local `mailpit` compose service so reset emails are real and
inspectable at http://localhost:8025, not just theoretical).

This backend's only job is validating the JWTs that flow comes with
(`SecurityConfig.jwtDecoder`) — see the hostname-splitting note just below,
which is the one genuinely tricky part of the setup.

## Roles & identity (FR-4/FR-5)

Keycloak issues three realm roles (`customer`, `doctor`, `admin` —
`deploy/keycloak/realm-export.json`) but holds no relationship data — no
groups, no user attributes. The backend maintains its own `users` table
(`V1__init.sql`), **JIT-provisioned from the JWT** on every request
by `security/CurrentUserService`: the first authenticated call from a
Keycloak user creates their local row (`username`/`email`/`role` re-synced
from the JWT every time — self-healing if the realm changes; `displayName`
and `temperatureUnit` are the fields a user owns locally, edited via
`PATCH /api/me` and never overwritten by sync).

The local row is looked up by `id` (the JWT `sub`) first, falling back to a
`username` lookup before creating a new row. This matters because the
`keycloak` service in `docker-compose.yml` runs `start-dev --import-realm`
with **no persistent volume** — a Keycloak-only restart (container restart,
`docker compose up` after a plain `down`, etc.) re-imports the realm and
issues a brand-new random `sub` per demo user, while Postgres's `users` table
(which *is* persisted) still has the old row keyed by the old `sub`. Without
the username fallback, that first request after a Keycloak restart would try
to insert a second row with the same (unique) `username` and 500 on every
subsequent request from that user. The fallback reuses the existing row (and
everything foreign-keyed to its `id` — devices, consents) instead.

**Live-feed keying:** the live MQTT feed is keyed by this same stable local
`id` on both sides — `live/{user_id}/...` on the backend publish side
(`MeasurementIngestService`) and, since the fix to
`fe/src/live/mqttClient.ts#subscribeLive`, on the browser subscription side
too (it subscribes with `useMe()`'s `id`, not the raw JWT `sub`). This
matters precisely because of the no-volume Keycloak restarts above: a
restart mints new `sub` values while the local rows (and their ids) persist,
so a feed subscribed by `sub` would silently stop arriving while REST
history kept working.

**Also relevant here:** `SecurityConfig.jwtDecoder` deliberately does *not*
use a single `issuer-uri` for both fetching Keycloak's signing keys and
validating the `iss` claim — see its Javadoc. The backend reaches Keycloak
over the compose network (`thermometer.oidc.jwk-set-uri` →
`keycloak:8080`), but a token's `iss` is whatever hostname Keycloak's
`KC_HOSTNAME` says (`docker-compose.yml` → `localhost:8082`, since that has
to be resolvable by an actual browser/mail client, not just this container —
see deploy/README.md). Collapsing these into one `issuer-uri` property (the
default Spring Boot way) breaks one side or the other depending on which
hostname you pick.

Deliberately **not** using Spring Security's `@PreAuthorize`/`hasRole()`:
under the `local` profile's fully-open filter chain, Spring's
`AnonymousAuthenticationFilter` populates `ROLE_ANONYMOUS`, which would make
any `hasRole(...)` check reject every local curl request — defeating the
`local` profile's "security disabled, everything curlable" purpose. Every
controller instead resolves a `CurrentUser` via `CurrentUserService.resolve()`
and does a plain role check, consistent with `DeviceController`'s pre-existing
explicit-check style.

**Device ownership**: a device can only ever have one owner at a time — claiming
one already owned by someone else is a 409 — but a customer may claim as many
devices as they like. (An early iteration capped this at one per customer via
a partial unique index; that turned out to be a real usability bug — a
customer couldn't claim a second device they were connected to — so the cap
was dropped and never made it into `V1__init.sql`'s single-schema baseline.)
Admin never claims a device for itself — that stays customer-only; admin gets
dedicated force-release/edit endpoints under `/api/admin/devices`.

**Consent** (`consent_links` table, now backed by `ConsentLink`/
`ConsentController`) is always patient-initiated — a customer grants a doctor
access to their own data — with admin able to revoke any link on a customer's
behalf. `MeasurementController.history()` enforces this: a doctor can only
read a device's history if its current owner has an active consent link to
them.

**Doctor dashboard summary** (`GET /api/doctor/patients/summary`, `ConsentController#myPatientsSummary`)
computes, per consenting patient, the latest reading (unbounded — always the
true last-known value so a stale patient still shows something) plus
avg/min/max/count/sparkline scoped to `?rangeHours`. It runs three small
queries per patient's device rather than one batched query — same "fine at
this MVP's scale, revisit if the patient list grows large" tradeoff as
`myPatients()`'s per-patient device lookup just above it.

**Known limitation of JIT provisioning:** `GET /api/doctors` (used to
populate the "grant access" dropdown) only lists doctors whose local `users`
row already exists — i.e. who have made at least one authenticated request.
A doctor account that exists in Keycloak but has never opened the app is
invisible to customers until they log in once. This is the direct tradeoff of
not calling the Keycloak Admin API to sync the full realm (see "Roles &
identity" above); acceptable for this MVP's scale, but worth knowing before
demoing a freshly-provisioned doctor account.

## Device & operator authentication

Two paths don't fit the "resolve a `CurrentUser` from a Keycloak JWT" model,
and both were security gaps that this pass closed.

**The two OTA collector endpoints** (`GET /api/rollouts/pending`,
`POST /api/rollouts/{id}/status`) are called by gateways and collectors, which
have no user identity. They were previously `permitAll()` with **no
compensating check at all** — any caller could enumerate firmware metadata by
BD address, and could POST fabricated `failed` statuses until a rollout tripped
its own auto-abort threshold and stalled for everyone.

They now require an `X-Device-Token` header holding
`thermometer.device.collector-token`, compared with `MessageDigest.isEqual`
(constant-time) and rejected with an identical 401 whether the header is
missing or wrong. The check lives in `RolloutController.requireCollectorToken()`
rather than the filter chain, deliberately: that keeps it in force under the
`local` profile too, where `thermometer.security.enabled=false` disables
everything else.

> **Known tradeoff — this is a fleet-wide shared secret, not per-device
> credentials.** Every collector presents the same token, so extracting it from
> one device compromises the OTA read path for all of them, and revocation is
> all-or-nothing. It matches the seam the Go gateway already had
> (`gateway/internal/auth/token.go`'s `StaticTokenProvider`) and is a large
> improvement over no authentication, but the real fix — credentials issued
> per device at provisioning time — needs device-provisioning infrastructure
> that doesn't exist yet, and is tracked as `../proposals.md` item 10.1. The
> tighter rate-limit bucket on these two endpoints (below) is the compensating
> control until then.

> **`POST /api/measurements` is deliberately *not* one of these paths**, even
> though it is described as an upload/ingest endpoint. Its caller is a browser
> holding a user's JWT, not a headless collector, so it stays under the normal
> JWT rule in `SecurityConfig` and is authorized by identity — see "Who may
> upload" under "Measurements & derived events". Giving it the shared
> `X-Device-Token` treatment instead would have meant shipping that fleet-wide
> secret to every browser, which is strictly worse than the ownership check.

**`/actuator/**`** is the one place role checks *can't* be in-controller, since
Spring Security handles those paths before any controller. Until this pass no
JWT→authority mapping existed, so `hasRole()` had nothing to match and
`/actuator/info` and `/actuator/prometheus` were readable by **any**
authenticated user — any customer's token could read operational metrics.

`SecurityConfig.keycloakRealmRoleConverter` now maps the JWT's
`realm_access.roles` claim to `ROLE_*` `SimpleGrantedAuthority`s, and
`/actuator/**` requires `hasRole("ADMIN")` — except `/actuator/health` and its
sub-paths, which stay open for probes. The converter is wired **only** into
`securedFilterChain`: the app's in-controller role-check convention is
unchanged, and the `local` profile's open chain (and therefore local curl
testing) is untouched.

## Data model

The schema started as one Flyway migration edited in place — fine while
nothing anywhere held data worth preserving. The local compose stack now does
(real device readings accumulate in the `postgres_data` volume), so **schema
changes go in new `V2__…sql` files from here on** and existing volumes
migrate in place instead of being reset. `V1__init.sql` covers, in
order: the `users` table and role model, `devices` (including
`last_seen_at`/`last_seen_type`, written by `MeasurementIngestService` on
every accepted reading so staleness checks cost one column read instead of an
N-device fan-out into the hypertable), the `measurements` hypertable,
`consent_links`, `alert_thresholds`, `measurement_annotations`, `care_notes`,
and the OTA rollout tables.

**`alert_thresholds`** holds four cut points — `normal_start_c`,
`elevated_start_c`, `fever_start_c`, `high_fever_start_c` — plus `scope`
(`system`/`self`/`doctor_override`), `subject_user_id` and `set_by_user_id`.
Each column is named after the tier it turns **on** at (`normal_start_c` is
the temperature at/above which a reading is tagged Normal, not the upper
bound of some other tier) — there is no column for "low", the implicit floor
tier below `normal_start_c`. This replaced an earlier `low_max_c`/
`normal_max_c`/`elevated_max_c`/`fever_max_c` naming (each field named after
the tier *below* the boundary, e.g. a field called "fever" that actually
gated High Fever) that read as confusing/negated in the UI; see
`fe/src/components/ThresholdEditor.tsx`. Two named check constraints do the
work a service layer would otherwise have to: `ck_alert_thresholds_monotonic`
keeps the four cut points strictly increasing (an inverted scale would
silently mis-tier every reading), and `ck_alert_thresholds_subject_scope`
enforces that `subject_user_id` is null exactly when the scope is `system`.
Three *partial* unique indexes give each scope its own upsert key — one
system row, one row per subject for `self`, one per (subject, doctor) for
`doctor_override` — rather than one nullable composite key that would let
duplicates through.

**`measurement_annotations`** stores `user_id`, `device_id`, `ts_from`,
nullable `ts_to` (a note can cover an instant or an interval) and the note
text. There is deliberately **no foreign key to `measurements`**: it's a
hypertable under a two-year retention policy, so an FK would either block
retention or cascade-delete a patient's notes when their old readings age out.
Annotations therefore outlive the readings they describe.

**`care_notes`** stores `doctor_user_id`, `patient_user_id` and the note, with
a `(doctor, patient, created_at DESC)` index matching the only read pattern.

**`devices.label`** (V2) is the owner's friendly name for the device — what
pickers and legends show instead of the BD address. Nullable; blank writes
are normalized to NULL, and every client falls back to the model string.
Renaming is the owner's alone (`PATCH /api/devices/{bdAddr}/label`, audited
as `device.rename`); admins have the same field through their edit endpoint.

**`devices.last_seen_at` / `last_seen_type`** are written by
`MeasurementIngestService` on every accepted reading. They exist so staleness
and device-health features cost one column read instead of an N-device fan-out
into the hypertable for "when did this device last report?".

## Rate limiting

`config/RateLimitFilter.java` throttles by caller IP with two Bucket4j token
buckets held in Caffeine caches:

| Bucket | Applies to | Default |
|--------|-----------|---------|
| blanket | every request | 240 req/min sustained, 80 back-to-back |
| collector | `GET /api/rollouts/pending`, `POST /api/rollouts/{id}/status` | 10 req/min, 10 back-to-back |

The second bucket exists because those two endpoints sit outside the JWT
filter chain and are guarded only by the fleet-wide shared `X-Device-Token`
(see "API surface" above) — a leaked token is the one credential that still
buys useful API access, so it is capped hard. Rollout traffic charges the
collector bucket first and the blanket bucket only if that one allowed it, so
hammering the collector endpoints doesn't lock the same address out of the
rest of the API.

`/actuator/health` and its sub-paths are exempt, so a probe (or a restart
loop) can never throttle the signal that decides whether the instance is up.
Everything else — including `/actuator/prometheus` — counts.

Three things worth knowing before changing this:

- **State is in-memory, per instance.** `docker-compose.yml` runs one
  `backend` with no replicas, so a distributed store (Redis) would buy
  nothing here. Running N instances silently turns the limit into
  `limit × N`; that's the trigger for revisiting this, not scale in itself.
- **`X-Forwarded-For` is caller-controlled** unless a proxy overwrites it, and
  nothing fronts the backend in the compose stack today — `docker-compose.yml`
  publishes `8080:8080` directly. `trust-forwarded-for` therefore defaults to
  **`false`**, keying on the socket address: trusting the header on this
  topology would let any caller rotate it for a fresh bucket per request
  (defeating both limits, including the tighter one that exists to blunt a
  leaked `X-Device-Token`) or set a victim's address to drain *their* bucket.
  A deployment that adds a trusted reverse proxy must set it back to `true` —
  behind an ingress every request shares one socket address, so the whole
  internet would otherwise share one bucket.
- **The filter runs before Spring Security** (servlet filter order −110 vs.
  Spring Security's −100, registered in `config/RateLimitConfig.java`) so
  floods are rejected before JWT validation or any database work. That's also
  why it applies the configured CORS headers to its own 429 by hand —
  `http.cors()` lives inside the security chain that hasn't run yet, and
  without them a browser would report an opaque network error instead of the
  rate-limit message.

Headroom: a single tab's baseline polling is ~24 req/min (5 s measurement
history + 5 s device list), but the multi-device/multi-patient overlay
features fan that out per selected series — up to 5 devices at 5 s each is
60 req/min from one feature alone — and several tabs, or several users behind
one NAT address, share this same per-IP bucket. 240/min keeps a few concurrent
tabs using overlay mode comfortably under the ceiling; raise
`thermometer.ratelimit.default.requests-per-minute` further if real usage
needs it, or set `thermometer.ratelimit.enabled=false` for load/e2e runs that
legitimately exceed it from a single address.

## Known gaps and deliberate limitations

Documented rather than quietly fixed or quietly shipped — each has a reason,
and each is tracked in `../proposals.md` §10.

**`GET /api/doctor/consent-activity` always returns an empty page** — by
design, not by bug. Consent audit rows record the *customer* as actor (they
grant and revoke), so filtering the audit log for "this doctor as actor" on
consent actions matches nothing. `GET /api/doctor/audit-log` — actor **or**
subject — is the query that actually carries a doctor's consent history, and
is what the frontend's `/audit` page renders. Making the dedicated endpoint
meaningful means changing what `audit_log` stores, not the query
(`../proposals.md` 10.5). Kept because the hook and the distinction are real.

**`PATCH /api/admin/users/{id}` only edits the local mirror.**
`CurrentUserService` re-syncs `role` from the JWT on the user's next request,
so a role change made here is overwritten at their next login. It is an
audited correction tool for a mirror that has drifted out of step with
Keycloak, **not** a role editor — the admin UI says so. A real one needs the
Keycloak Admin API, a confidential service-account client with
`realm-management` roles, and a decision about what happens when Keycloak is
unreachable mid-change (`../proposals.md` 10.4).

**Care-note visibility: doctor-private, no patient read path.** Consent in
this system flows patient→doctor only; there is no doctor→patient channel, so
there is nowhere for a patient-visible note to appear and no consent semantics
covering it. Admin gets a read-only compliance view
(`GET /api/admin/care-notes`); patients cannot read care notes at all.
Whether that should change is a clinical/legal decision rather than an
engineering one and needs product sign-off (`../proposals.md` 10.6) — the code
change itself would be small.

**Keycloak itself is still not in the test loop.** `RbacIT` drives
role-differentiated requests with hand-built JWT-backed `Authentication`s
because the `test` profile disables JWT parsing entirely, so what is verified
is every *authorization* decision the application makes — not that a real
Keycloak-issued token is validated correctly (that needs a Keycloak in CI).
The frontend's Playwright suite covers the real login round trip instead.

**No battery telemetry reaches this service.** The ingest switch already
handles `type=battery`, but nothing publishes it — not the gateway, not the
browser BLE transport, not the simulator — so the frontend's device-health
widget ships staleness-only (`../proposals.md` 10.2). Nothing needs to change
here to close it.

**No test boots the full `docker`-profile Spring context.** `mvn verify`
was green throughout this pass while the application was, at one point,
completely unable to start under the `docker` profile — a lambda-based
`Converter` bean broke `WebMvcAutoConfiguration`'s reflection-based converter
scan, a failure mode `@SpringBootTest`'s narrower context never exercises.
Caught only by running `docker compose up` and reading `/actuator/health` by
hand. A single `@SpringBootTest(webEnvironment = RANDOM_PORT)` with `docker`
active would close this (`../proposals.md` 10.9).

**`CurrentUserService`'s JIT-provisioning insert-race retry is untested.**
Two concurrent first-requests from the same brand-new JWT subject could both
miss the lookup and race to insert the same row — caught live by
`npm run test:e2e` against the running stack (the `Connect (Simulated
Device)` flow fires several calls right after a fresh sign-in), not by any
integration test, since none of them race two concurrent logins for the same
never-seen subject (`../proposals.md` 10.10).

## What's implemented vs. scaffolded

| Area | Status |
|------|--------|
| MQTT ingest (direct subscribe, QoS 1, ack-after-commit, retry-connect) | ✅ implemented, integration-tested |
| Live-feed fan-out to `live/{user_id}/...` on every successful ingest (MQTT or REST path) | ✅ implemented, integration-tested — only fans out once a device is claimed (has an owner) |
| Idempotent measurement storage (TimescaleDB hypertable) | ✅ implemented, tested |
| Device claim/list/release REST API — a device has one owner at a time, a customer may own several | ✅ implemented, integration-tested |
| DIY OTA rollout (percentage groups, abort threshold, version comparison) | ✅ implemented, unit-tested — **not** hawkBit; see architecture v3 §15 for the adoption trigger |
| Keycloak JWT validation (`docker` profile) | ✅ wired up (Spring Security OAuth2 Resource Server) — not exercised by an automated test in this repo (would need a running Keycloak in CI); role-differentiated logic is instead tested at the controller layer with hand-built JWTs, see `RbacIT` |
| Role-based access control (FR-5): customer/doctor/admin, local `users` table, JIT provisioning | ✅ implemented, integration-tested (`RbacIT`) |
| Consent links (FR-4): patient-initiated grant/revoke, doctor-scoped measurement access | ✅ implemented, integration-tested — fine-grained `scope` (e.g. "vitals only") is schema-only, unused (full access implied) |
| Admin console API: full user/device/relationship visibility + force-release/edit | ✅ implemented, integration-tested (`RbacIT`) — search/filter/pagination on users plus an audited local-mirror role correction, with the self-lockout guard (an admin cannot change their own role) pinned by test (see "Known gaps") |
| Alert thresholds (system / personal / doctor-override, whole-row precedence, batch resolution) | ✅ implemented (`threshold/AlertThresholdService`, `alert_thresholds` in `V1__init.sql`), integration-tested (`RbacIT`) — per-scope authorization and the full doctor_override → self → system → fallback ladder, asserted through the controller so a route that forgets to pass `viewingDoctorId` is caught |
| Temperature events: threshold-crossing episodes derived on read from the hypertable | ✅ implemented (`event/TemperatureEventService`), integration-tested (`RbacIT`) — no events table, so a threshold change re-tiers history automatically; `detectBatch` is one query for a whole fleet. Tests pin that the device feed enforces the same ownership/consent rule as measurement history and that the fleet feed contains exactly the consenting patients |
| Reading annotations (customer) + care notes (doctor-private, admin-readable) | ✅ implemented (`measurement_annotations`/`care_notes` in `V1__init.sql`), integration-tested (`RbacIT`) — annotation reads follow device access while edits/deletes are author-scoped (404, not 403); care notes stay invisible to a second doctor holding equal consent, and to the patient. See "Known gaps" for care-note visibility |
| Doctor fleet summary enriched with stddev / risk score / risk tier / staleness | ✅ implemented — one added `STDDEV_POP` in the existing query, no extra round trip |
| Admin analytics (ingest health, device inventory, user growth, consent integrity, retention, security ops) | ✅ implemented (`admin/AdminAnalyticsController`), integration-tested (`RbacIT`) — all six panels run their raw SQL against the real schema and reject every non-admin caller. Retention counts are `pg_class.reltuples` estimates by design, not `COUNT(*)` on the hypertable |
| Shared device-access guard reused by measurements, events, annotations | ✅ implemented (`security/DeviceAccessGuard`), integration-tested (`RbacIT`) — read rule (ownership/consent) and the stricter owner-only ingest rule both live here; tests also pin the accepted residual risk, that readings seeded for an *unclaimed* address stay unreadable by everyone but an admin |
| `access.denied` audit rows on every 403 | ✅ implemented (`security/AccessDeniedAuditor`) — a `HandlerExceptionResolver` that observes and returns null, so the error body the frontend parses is unchanged |
| OTA collector endpoint authentication (`X-Device-Token`) | ✅ implemented, integration-tested (`RbacIT` + `RolloutCollectorTokenIT`) — missing/wrong/blank tokens all rejected identically as 401, the correct one sufficient with no user identity, and a fully-privileged admin in the SecurityContext buys nothing. Fleet-wide **shared** secret, not per-device credentials; see "Device & operator authentication" |
| Actuator lockdown (`/actuator/**` → `ROLE_ADMIN`, `/health` open) via a Keycloak realm-role JWT converter | ✅ implemented — the converter is scoped to the secured chain only |
| Pagination on admin/audit/rollout listings (`PageResponse<T>`) | ✅ implemented |
| Login/logout/password-change/forgot-password (Authorization Code + PKCE, Keycloak-hosted UI) | ✅ implemented — see "Authentication" above; verified end-to-end with real Playwright browser tests (`fe/e2e/thermometer.spec.ts`), including a real password-reset email round-tripped through the local `mailpit` SMTP catcher |
| Firmware image upload/signing to MinIO | ⏸ not implemented — `rollouts.image_url`/`delta_url` are plain strings; nothing in this service talks to MinIO yet |
| Rate limiting (Bucket4j + Caffeine, per-caller-IP, blanket + collector-endpoint buckets) | ✅ implemented, unit-tested (`RateLimitFilterTest`) and integration-tested (`RolloutCollectorTokenIT` proves it is actually registered in the servlet chain) — see "Rate limiting" above; in-memory and per-instance by design (single backend service, no replicas), keyed on the socket address unless a trusted proxy is declared |
| Audit log writes | ✅ implemented for ownership/access actions (claim, release, admin force-release/edit, consent grant/revoke) |
| GraalVM Native Image | ⏸ not wired up — explicit opt-in per architecture v3 §2.3, plain JVM mode only |

## Source layout

```
src/main/java/com/dialog/thermometer/
├── ThermometerBackendApplication.java
├── config/
│   ├── SecurityConfig.java              local (open) vs. docker (Keycloak JWT) filter chains; jwtDecoder bean
│   │                                    splits key-fetch (docker-internal) from iss validation (external hostname);
│   │                                    keycloakRealmRoleConverter (realm_access.roles -> ROLE_*) gates /actuator/**
│   ├── RateLimitFilter.java             per-caller-IP token buckets (blanket + tighter collector-endpoint one)
│   └── RateLimitConfig.java             registers the filter ahead of Spring Security's own servlet filter
├── security/
│   ├── Role.java                        customer/doctor/admin enum
│   ├── CurrentUser.java                 resolved-identity record
│   ├── CurrentUserService.java          JIT-provisions/re-syncs the local users row from the JWT
│   ├── DeviceAccessGuard.java           the one device authorization check: ownership/consent for reads (measurements,
│   │                                    events, annotations) and owner-only ingest for the REST upload path
│   └── AccessDeniedAuditor.java         writes an access.denied audit row on every 403 (observes, doesn't handle)
├── threshold/
│   ├── AlertThresholdService.java       resolve()/resolveBatch() — doctor_override > self > system > fallback;
│   │                                     resolveBatch is 3 queries regardless of patient count
│   └── ThresholdController.java         scoped read/upsert/clear for customer, doctor and admin
├── event/
│   ├── TemperatureEvent.java            derived episode record (device, tier, start/end, peak, reading count)
│   ├── TemperatureEventService.java     detect()/detectBatch() over the raw hypertable — no events table
│   └── EventController.java             per-device and doctor-fleet episode feeds
├── annotation/
│   └── AnnotationController.java        customer reading notes — owner-only write, guard-checked read
├── care/
│   └── CareNoteController.java          doctor-private clinical notes (admin reads via AdminController)
├── admin/
│   └── AdminAnalyticsController.java    ingest/inventory/growth/consent-integrity/retention/security-ops
├── ingest/
│   ├── MeasurementEnvelope.java         shared wire format (record, self-validating)
│   ├── MeasurementIngestService.java     idempotent upsert (dedup key device_id/type/ts), auto-registers
│   │                                     unclaimed devices on first reading, live-feed fan-out
│   ├── MqttGateway.java                  owns the MQTT connection: retry-connect, subscribe registry, publish
│   └── MqttIngestSubscriber.java         registers the ingest subscription on MqttGateway
├── domain/
│   ├── Device.java, DeviceRepository.java
│   ├── User.java, UserRepository.java             local mirror of a Keycloak identity (+ search(q, role, Pageable))
│   ├── ConsentLink.java, ConsentLinkRepository.java   FR-4 patient→doctor consent
│   ├── AlertThreshold.java, AlertThresholdRepository.java    scoped tier scales (see "Data model")
│   ├── MeasurementAnnotation.java, MeasurementAnnotationRepository.java   customer reading notes
│   ├── CareNote.java, CareNoteRepository.java     doctor-private clinical notes
│   └── AuditLog.java, AuditLogRepository.java     + JpaSpecificationExecutor for the filterable admin viewer
├── rollout/
│   ├── Rollout.java, RolloutTarget(Id).java, *Repository.java   (+ grouped progress-count projection)
│   └── RolloutService.java               percentage bucketing, version compare, auto-abort
└── api/
    ├── DeviceController.java             claim/release/available/list (role-branched), lastSeen fields
    ├── MeasurementController.java        ingest + guard-checked history
    ├── MeController.java                 GET/PATCH own profile
    ├── ConsentController.java            grant/revoke/list consent, doctor list, doctor's patients + dashboard
    │                                     summary (risk/stddev/staleness), access-history + doctor audit feeds
    ├── AdminController.java              paged/filterable users, consents, audit log, care-note compliance view,
    │                                     local-mirror role correction, device force-release/edit
    ├── RolloutController.java            admin list/detail + the two X-Device-Token collector endpoints
    └── dto/                              request/response records, incl. PageResponse<T>
src/main/resources/
├── application.yml, application-local.yml, application-docker.yml
└── db/migration/
    ├── V1__init.sql   the whole schema as one file — users/roles, devices (+ last_seen_at/
    │                   last_seen_type), the measurements hypertable, consent_links,
    │                   alert_thresholds (3-scope tier scales, monotonicity + scope check
    │                   constraints), measurement_annotations (customer notes, no FK to the
    │                   hypertable on purpose), care_notes (doctor-private), and the OTA
    │                   rollout tables
    └── V2__device_label.sql  first incremental migration: devices.label (customer-set name)
```

The schema started as one Flyway migration edited in place — fine while
nothing anywhere held data worth preserving. The local compose stack now
does (real device readings accumulate in `postgres_data`), so that changed:
**schema changes go in new `V2__…sql` files from here on**, so existing
volumes migrate in place instead of being reset.
