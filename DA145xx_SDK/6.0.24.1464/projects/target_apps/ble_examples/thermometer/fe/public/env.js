// Runtime configuration placeholder — deliberately EMPTY in the repo.
//
// index.html loads this before the bundle, and the nginx image's entrypoint
// (docker/20-render-runtime-config.sh) OVERWRITES it at container start with
// the real API_BASE_URL / MQTT_WS_URL / KEYCLOAK_URL, so one built image is
// promotable across environments (review INF-17).
//
// It stays empty here so `npm run dev`, `vite preview` and the Capacitor
// WebView (which serve dist/ straight from disk, with no entrypoint) find the
// file instead of a 404 and fall through to the build-time VITE_* vars — see
// src/config/env.ts for the full resolution order.
window.__ENV__ = {};
