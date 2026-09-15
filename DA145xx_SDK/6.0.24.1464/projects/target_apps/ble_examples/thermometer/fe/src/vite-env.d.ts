/// <reference types="vite/client" />

/**
 * Build-time environment. These are the local-dev (`.env.local`) and Capacitor
 * path only — the container configures the same three values at RUNTIME through
 * `window.__ENV__` (declared in ./config/env.ts, which is the one place either
 * source should be read from).
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MQTT_WS_URL?: string;
  readonly VITE_KEYCLOAK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
