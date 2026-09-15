/**
 * The one place the app resolves its three external endpoints (API, MQTT
 * WebSocket, Keycloak).
 *
 * Resolution order per value — `window.__ENV__` first, then the build-time
 * `VITE_*` var, then a localhost dev default:
 *
 * 1. **`window.__ENV__`** — written by `/env.js`, which the nginx image's
 *    entrypoint (`docker/20-render-runtime-config.sh`) renders from the
 *    container's `API_BASE_URL` / `MQTT_WS_URL` / `KEYCLOAK_URL` at start.
 *    This is what makes one built image promotable across environments
 *    instead of baking URLs in at build time (review INF-17). The repo's
 *    `public/env.js` ships an empty `window.__ENV__` so the script tag in
 *    `index.html` never 404s in `npm run dev`, `vite preview`, or the
 *    Capacitor WebView.
 * 2. **`import.meta.env.VITE_*`** — the local-dev (`.env.local`) and
 *    Capacitor path: the mobile shell loads `../fe/dist` from the app bundle,
 *    so there is no server to render `env.js` and the URLs have to be baked
 *    in at `npm run build` time. See `../../../mobile/README.md`.
 * 3. **`http://localhost:*` defaults** — the docker-compose dev stack.
 *
 * Empty strings count as unset, so a missing compose variable degrades to the
 * next source rather than producing `fetch('')`.
 */

export interface RuntimeEnv {
  API_BASE_URL?: string;
  MQTT_WS_URL?: string;
  KEYCLOAK_URL?: string;
}

declare global {
  interface Window {
    __ENV__?: RuntimeEnv;
  }
}

function firstNonEmpty(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function runtime(): RuntimeEnv {
  // `window` is absent under vitest's node environment for pure-module tests.
  return typeof window === 'undefined' ? {} : (window.__ENV__ ?? {});
}

/** Base URL of the Spring Boot API, without a trailing slash. */
export function apiBaseUrl(): string {
  return firstNonEmpty(runtime().API_BASE_URL, import.meta.env.VITE_API_BASE_URL, 'http://localhost:8080').replace(
    /\/+$/,
    '',
  );
}

/** Mosquitto's WebSocket listener, e.g. `ws://localhost:9001`. */
export function mqttWsUrl(): string {
  return firstNonEmpty(runtime().MQTT_WS_URL, import.meta.env.VITE_MQTT_WS_URL, 'ws://localhost:9001');
}

/** Keycloak's base URL (the realm path is appended by `auth/oidc.ts`). */
export function keycloakUrl(): string {
  return firstNonEmpty(runtime().KEYCLOAK_URL, import.meta.env.VITE_KEYCLOAK_URL, 'http://localhost:8082').replace(
    /\/+$/,
    '',
  );
}
