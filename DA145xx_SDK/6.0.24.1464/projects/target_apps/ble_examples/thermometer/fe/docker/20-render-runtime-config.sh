#!/bin/sh
# Runtime configuration for the fe image (review INF-17 + INF-09).
#
# Runs from /docker-entrypoint.d/ before nginx starts (the nginx image's
# entrypoint sources every executable *.sh there in lexical order) and does two
# things from the SAME three container environment variables:
#
#   1. rewrites /usr/share/nginx/html/env.js, the file index.html loads before
#      the bundle, so the browser learns this environment's URLs at page load
#      instead of having them baked into the JS at image build time;
#   2. renders /etc/nginx/conf.d/default.conf from the shipped template so the
#      Content-Security-Policy's connect-src/frame-src name exactly those
#      origins and nothing else.
#
# Environment (all optional; each falls back to the localhost docker-compose
# default, which is also what src/config/env.ts assumes when unset):
#   API_BASE_URL   base URL of the Spring Boot API          http://localhost:8080
#   MQTT_WS_URL    Mosquitto's WebSocket listener           ws://localhost:9001
#   KEYCLOAK_URL   Keycloak base URL (realm path appended)  http://localhost:8082
#
# These are the URLs the BROWSER calls, so they must be reachable from the
# user's machine — not docker-compose service names.
set -eu

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
MQTT_WS_URL="${MQTT_WS_URL:-ws://localhost:9001}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8082}"

# A CSP source is an origin: scheme://host[:port], no path. Strip anything from
# the third slash on so an API base URL that carries a path (http://host/api)
# still yields a usable policy.
origin_of() {
  printf '%s' "$1" | sed -E 's#^([a-zA-Z][a-zA-Z0-9+.-]*://[^/]+).*$#\1#'
}

CSP_API_ORIGIN="$(origin_of "$API_BASE_URL")"
CSP_MQTT_ORIGIN="$(origin_of "$MQTT_WS_URL")"
CSP_KEYCLOAK_ORIGIN="$(origin_of "$KEYCLOAK_URL")"
export CSP_API_ORIGIN CSP_MQTT_ORIGIN CSP_KEYCLOAK_ORIGIN

# JSON string escaping: a URL cannot legally contain a raw " or \, but env vars
# are external input and a broken env.js would take the whole app down.
json_escape() {
  printf '%s' "$1" | sed -e 's#\\#\\\\#g' -e 's#"#\\"#g'
}

cat > /usr/share/nginx/html/env.js <<EOF
// Generated at container start by docker/20-render-runtime-config.sh —
// do not edit, every restart overwrites it. Served with Cache-Control: no-store.
window.__ENV__ = {
  API_BASE_URL: "$(json_escape "$API_BASE_URL")",
  MQTT_WS_URL: "$(json_escape "$MQTT_WS_URL")",
  KEYCLOAK_URL: "$(json_escape "$KEYCLOAK_URL")"
};
EOF

# Only the three CSP_* names are substituted, so nginx's own $uri / $csp /
# $host survive the pass untouched.
envsubst '${CSP_API_ORIGIN} ${CSP_MQTT_ORIGIN} ${CSP_KEYCLOAK_ORIGIN}' \
  < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

echo "fe runtime config: api=$API_BASE_URL mqtt=$MQTT_WS_URL keycloak=$KEYCLOAK_URL"
