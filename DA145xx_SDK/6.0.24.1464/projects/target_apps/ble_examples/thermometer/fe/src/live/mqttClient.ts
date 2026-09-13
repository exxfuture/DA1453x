import mqtt, { MqttClient } from 'mqtt';
import { getAuthSubject } from '../auth/oidc';

const MQTT_WS_URL = import.meta.env.VITE_MQTT_WS_URL ?? 'ws://localhost:9001';

// No multi-tenant model wired up yet (roadmap phase 3, architecture v3 §9) —
// a fixed tenant segment is used everywhere for now. The publish topic's user
// segment is not identity-bearing on the backend side (ingest matches it with
// a `+` wildcard and fans out by devices.owner_user_id), so the raw JWT `sub`
// is fine there, with the backend's dev-mode default subject as fallback.
//
// The *subscription* topic is a different matter — see subscribeLive().
const TENANT = 'default';
const DEV_FALLBACK_USER = 'local-dev-user';

function currentUserId(): string {
  return getAuthSubject() ?? DEV_FALLBACK_USER;
}

export interface MeasurementEnvelope {
  v: number;
  device_id: string;
  collector_id: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

// The backend publishes the full envelope unchanged to the live topic
// (MeasurementIngestService.publishLiveEvent), so a live message has exactly
// the same shape — snake_case device_id included — as what was ingested.
export type LiveMeasurement = MeasurementEnvelope;

let sharedClient: MqttClient | null = null;

function getClient(): MqttClient {
  if (!sharedClient) {
    sharedClient = mqtt.connect(MQTT_WS_URL, {
      clientId: `web-${Math.random().toString(16).slice(2)}`,
      reconnectPeriod: 2000,
    });
  }
  return sharedClient;
}

/**
 * Direct MQTT/WSS publish (architecture v2 §5.2 / v3 §7) — no relay through
 * the backend. Falls back to nothing here; callers that need a guaranteed
 * delivery path should also call api.uploadMeasurement() as the REST fallback.
 */
export function publishMeasurement(envelope: MeasurementEnvelope): void {
  const topic = `v1/${TENANT}/${currentUserId()}/${envelope.device_id}/measurement/${envelope.type}`;
  getClient().publish(topic, JSON.stringify(envelope), { qos: 1 });
}

/**
 * Direct MQTT/WSS subscription for the live feed — the browser talks to the
 * broker itself, no custom WebSocket relay through the API (architecture v2
 * §7.1 changelog, v3 §7).
 *
 * `backendUserId` must be {@link import('../api/client').MeResponse}`.id` —
 * the stable local `users.id` from `useMe()` — **not** the JWT `sub`. The
 * backend fans readings out under `live/{owner_user_id}/...` using that
 * local id (`MeasurementIngestService.publishLiveEvent`), while Keycloak's
 * dev-mode container re-imports its realm on every restart and mints a brand
 * new `sub` per user against the same persisted Postgres rows. Subscribing
 * by `sub` therefore silently detaches the feed after any Keycloak restart;
 * subscribing by the same id the backend publishes with is immune.
 */
export function subscribeLive(
  onMessage: (measurement: LiveMeasurement) => void,
  backendUserId: string,
): () => void {
  const client = getClient();
  const topic = `live/${backendUserId}/#`;

  const handleConnect = () => client.subscribe(topic);
  const handleMessage = (_topic: string, payload: Buffer) => {
    try {
      onMessage(JSON.parse(payload.toString()) as LiveMeasurement);
    } catch {
      // malformed live-feed message — ignore, the durable upload path is unaffected
    }
  };

  client.on('connect', handleConnect);
  client.on('message', handleMessage);
  if (client.connected) {
    handleConnect();
  }

  return () => {
    client.off('connect', handleConnect);
    client.off('message', handleMessage);
    client.unsubscribe(topic);
  };
}
