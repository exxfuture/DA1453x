# deploy/

Configuration consumed by `../docker-compose.yml` (the local stack) and
`../docker-compose.prod.yml` (the hardened overlay). The local stack is a
laptop profile: every host port bound to `127.0.0.1`, development-default
credentials overridable from a `.env` file (`../.env.example`), pinned
images, an authenticated broker, but plain HTTP. The overlay removes the
host ports, requires real secrets, and terminates TLS in Caddy — see the
header of `../docker-compose.prod.yml` for the full list of differences.

- `mosquitto/mosquitto.conf` — MQTT (1883) + MQTT-over-WebSocket (9001)
  listeners with the built-in **dynamic-security plugin** and
  `allow_anonymous false`. The client/role database
  (`/mosquitto/data/dynamic-security.json`, on the `mosquitto_data` volume)
  is created on the container's first start by `mosquitto_ctrl dynsec init`
  with one admin client (`MQTT_ADMIN_USERNAME` / `MQTT_ADMIN_PASSWORD`,
  compose defaults `admin` / `mqtt-admin-dev`). The backend connects as that
  admin and is the only provisioning authority from then on
  (`../backend/README.md` "MQTT broker identities"):

  | Identity | Who uses it | May publish | May subscribe |
  |----------|-------------|-------------|---------------|
  | dynsec admin (`MQTT_ADMIN_USERNAME`) | backend | `live/#` (its own `backend` role) + `$CONTROL/dynamic-security/#` | everything (ingest) |
  | `collector` (password `MQTT_COLLECTOR_PASSWORD`, default `collector-dev`) | the `gateway-N` services, `../tools/simulate-device.sh` | `v1/+/collector/+/measurement/+` | nothing |
  | `user-<id>` (random password, minted per browser session via `POST /api/live/credentials`) | the web app | `v1/default/<id>/+/measurement/+` | `live/<id>/#` |

  A changed `MQTT_ADMIN_*` only takes effect on a fresh volume
  (`docker compose down -v`) — the database file, not the environment, is
  what the broker reads afterwards. The broker's healthcheck subscribes to
  `$SYS/broker/uptime` as the admin.

  TLS: the plain listeners are reachable only inside the compose network
  (and, locally, on `127.0.0.1`); the overlay exposes the WebSocket listener
  as `wss://PUBLIC_HOST/mqtt` through Caddy.

- `caddy/Caddyfile` — the overlay's TLS-terminating reverse proxy: one
  `PUBLIC_HOST`, path-routed to the web app (`/`), the backend (`/api/*`,
  `/actuator/*`), Keycloak (`/auth/*`, `KC_HTTP_RELATIVE_PATH=/auth`) and
  the broker's WebSocket listener (`/mqtt`). `CADDY_TLS=internal` uses
  Caddy's own CA (lab / LAN); an e-mail address switches to ACME. HSTS is set
  here; the web app's nginx sets the CSP and the other browser headers
  itself (`../fe/README.md`).

- `postgres/init-keycloak-db.sql` — overlay only: creates the `keycloak`
  database inside the shared TimescaleDB instance on first init, because the
  overlay runs Keycloak in production mode (`start`), which needs a real
  database. The local stack's `start-dev` Keycloak uses its own H2.

- `keycloak/realm-export.json` — a `thermometer` realm with the three roles
  from the architecture (`customer`, `doctor`, `admin`), a public
  `thermometer-web` client (standard Authorization Code flow, PKCE
  required — `directAccessGrantsEnabled: false`, no resource-owner-password
  grant), `resetPasswordAllowed: true` (Keycloak's own built-in
  "Forgot password?" flow) with `smtpServer` pointed at the local `mailpit`
  compose service so reset emails are real and viewable at
  http://localhost:8025, a realm password policy (length ≥ 8, upper/lower/
  digit/special char), `sslRequired: external` (plain HTTP is accepted from
  private/loopback addresses only — which is all the local stack uses, and
  the backend reaches Keycloak over the private compose network — while any
  public address must come in over TLS), and four **demo-only** users
  (`customer1`/`customer2`/`doctor1`/`admin1` — passwords follow the
  `<Role><NN>!` pattern and satisfy the policy, see `../README.md`'s demo
  accounts table — two customers so multi-patient/multi-device scenarios
  are demonstrable). Imported automatically on the local Keycloak's startup
  via `start-dev --import-realm`. **The overlay does not import it**: demo
  users with committed passwords and `localhost` redirect URIs must not
  exist on a public deployment; provision the realm there yourself (admin
  console, or your own realm file mounted at `/opt/keycloak/data/import`)
  with `https://PUBLIC_HOST/*` as the client's redirect URI / web origin.

  The local Keycloak has no persistent volume, so recreating the
  `keycloak` container re-imports this file from scratch — any password
  changed via the app (or any other in-console edit) is lost, back to what's
  in this file. **`docker compose restart keycloak` does *not* trigger a
  reimport** — that only restarts the process inside the same container,
  which still has its prior in-memory/dev-mode state. To actually pick up a
  `realm-export.json` change: `docker compose up -d --force-recreate
  keycloak`.

- `keycloak/themes/thermometer/` — a custom login theme matching the web
  app's "Pine & Ember" design (fonts, colors, card/button styling), so
  logging in doesn't look like a jump to an unrelated product. CSS-only on
  top of Keycloak's built-in `keycloak.v2` theme (`theme.properties` sets
  `parent=keycloak.v2` and layers in `login/resources/css/login.css`) — no
  forked FreeMarker templates, so it keeps working across Keycloak version
  bumps instead of drifting from upstream markup. **`../DESIGN_SYSTEM.md`
  §7** is the canonical reference for this theme — the exact token values it
  mirrors, the PatternFly quirks found while building it (form-control's
  double-border risk, the stray pseudo-element underline, the password
  show/hide toggle's default dark "control" button skin), and how to verify
  a change. Activated via `loginTheme: "thermometer"` in
  `realm-export.json`; the realm's
  `displayName: "Thermometer"` replaces the default Keycloak wordmark in the
  page header without needing a template override.

  To iterate on it: `docker-compose.yml` mounts the theme directory read-only
  and sets `KC_SPI_THEME_CACHE_THEMES: "false"` / `KC_SPI_THEME_STATIC_MAX_AGE:
  "-1"`, so editing `login.css` and reloading the login page in the browser
  is enough to see the change — no container restart needed. The exact
  PatternFly v5 class names `login.css` targets (`.pf-v5-c-*`) have moved
  between Keycloak releases before; if a future image bump silently drops the
  styling, inspect the rendered login page's DOM and adjust the selectors —
  the plain-element rules (`body`, `input`, `button[type="submit"]`, `a`) are
  a deliberate fallback that should keep working even then.

## Image pins

Every image in `../docker-compose.yml` is pinned (`timescale/timescaledb:
2.28.3-pg16`, `quay.io/keycloak/keycloak:26.0.8`, `axllent/mailpit:v1.31.1`,
`quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`, `eclipse-mosquitto:2` by
digest because the 2.1 line publishes no per-patch tags, `caddy:2.10.0-alpine`
in the overlay). Bump them deliberately; the database pin in particular
fixes the TimescaleDB extension version that `postgres_data` volumes are
created with.

## Health and start order

Every service has a healthcheck (`pg_isready`, Keycloak's `/health/ready`
on the management port, mailpit's `readyz`, MinIO's `mc ready local`, the
broker's `$SYS` subscription, the backend's `/actuator/health`, the web
app's `/health`) and every `depends_on` waits for `service_healthy`, so a
cold `docker compose up` converges without restarts: the backend starts only
once Postgres, the broker and Keycloak answer; the web app and the
simulated gateways only once the backend is healthy (the gateways need the
`collector` broker client the backend provisions).

## Calling the secured API directly

There's no curl-able password grant (`directAccessGrantsEnabled` is off,
matching a real Authorization Code + PKCE deployment) — get a token the way
a real client would: log into the fe app in a browser
(http://localhost:8090), open devtools → Application → **Session Storage**
(tokens are no longer kept in Local Storage — `../fe/README.md`), and copy
`access_token` out of the `oidc.user:...` JSON value.

```bash
curl -s http://localhost:8080/api/me -H "Authorization: Bearer <token>"
```

Tokens are short-lived (5 min); `fe/src/auth/oidc.ts`'s `automaticSilentRenew`
keeps the browser's own copy fresh, but a copy-pasted one will expire — grab
a new one from devtools if requests start 401ing.
