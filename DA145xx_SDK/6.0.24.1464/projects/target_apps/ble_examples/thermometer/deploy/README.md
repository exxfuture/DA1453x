# deploy/

Local-dev configuration consumed by `../docker-compose.yml`. Nothing here is
a production configuration — see the "local dev posture" notes inline in
each file.

- `mosquitto/mosquitto.conf` — MQTT (1883) + MQTT-over-WebSocket (9001)
  listeners, anonymous access enabled. Production needs the broker's
  JWT-auth plugin (or mTLS) per architecture v3 §8.2 — not configured here.
- `keycloak/realm-export.json` — a `thermometer` realm with the three roles
  from the architecture (`customer`, `doctor`, `admin`), a public
  `thermometer-web` client (standard Authorization Code flow, PKCE
  required — `directAccessGrantsEnabled: false`, no resource-owner-password
  grant), `resetPasswordAllowed: true` (Keycloak's own built-in
  "Forgot password?" flow) with `smtpServer` pointed at the local `mailpit`
  compose service so reset emails are real and viewable at
  http://localhost:8025, a realm password policy (length ≥ 8, upper/lower/
  digit/special char), and four **demo-only** users
  (`customer1`/`customer2`/`doctor1`/`admin1` — passwords satisfy the
  policy, see `../README.md`'s demo accounts table — two customers so
  multi-patient/multi-device scenarios are demonstrable). Imported
  automatically on Keycloak startup via `start-dev --import-realm`.

  Keycloak has no persistent volume in this compose setup, so recreating the
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

## Calling the secured API directly

There's no curl-able password grant anymore (`directAccessGrantsEnabled` is
off, matching a real Authorization Code + PKCE deployment) — get a token the
way a real client would: log into the fe app in a browser
(http://localhost:8090), open devtools → Application → Local Storage, and
copy `access_token` out of the `oidc.user:...` JSON value.

```bash
curl -s http://localhost:8080/api/me -H "Authorization: Bearer <token>"
```

Tokens are short-lived (5 min); `fe/src/auth/oidc.ts`'s `automaticSilentRenew`
keeps the browser's own copy fresh, but a copy-pasted one will expire — grab
a new one from devtools if requests start 401ing.
