import type { MqttClient } from 'mqtt';
import { api } from '../api/client';
import { mqttWsUrl } from '../config/env';
import type { MeasurementEnvelope } from './envelope';

/**
 * Direct MQTT/WSS publish + live subscribe (architecture v2 §5.2 / v3 §7) — the
 * browser talks to Mosquitto itself, with no relay through the API.
 *
 * AUTHENTICATION (review FE-03). The broker runs the dynamic-security plugin
 * with `allow_anonymous false`, so nothing connects without credentials. Before
 * the first publish or subscription this module calls
 * `POST /api/live/credentials` (JWT-authenticated); the backend mints a
 * short-lived, per-user broker client whose ACLs allow exactly
 *
 *   subscribe  live/<userId>/#
 *   publish    v1/default/<userId>/+/measurement/+
 *
 * and returns `{ username, password, userId, expiresAt }`. Every mint rotates
 * the password, so the previous credential dies — see
 * `../../../backend` and the broker config in `../../../deploy/mosquitto/`.
 *
 * Two consequences for the code below:
 *
 *  - **The user segment is server-asserted.** `userId` comes back from the mint
 *    call (it is the same `users.id` that `GET /api/me` returns as `id`) and is
 *    used for BOTH the publish topic's user segment and the live subscription.
 *    Nothing is derived from a caller-supplied value or from the JWT `sub` any
 *    more: `sub` was never the id the backend fans out under
 *    (`MeasurementIngestService.publishLiveEvent` uses the local id, and
 *    Keycloak mints a fresh `sub` per user whenever the dev container
 *    re-imports its realm), and a client-chosen id is exactly what FE-03
 *    flagged. The broker ACL would reject a mismatch anyway.
 *  - **Connecting is async.** The client cannot exist before the credential
 *    does, so `publishMeasurement` returns a promise and `subscribeLive`
 *    registers its listener immediately while the session opens in the
 *    background.
 *
 * A connection or authorisation failure re-mints **once** (a rotated password —
 * another tab minted after this one — is the expected cause) and reconnects; a
 * second failure is left to mqtt.js's own reconnect loop rather than hammering
 * the API.
 *
 * mqtt.js itself is `import()`ed rather than imported statically: it is ~370 kB
 * of the bundle and only the Connect page's live feed needs it, so a doctor or
 * an admin should never download it (review FE-31). Opening a session already
 * has to await the credential mint, so there is no extra latency step.
 */

// No multi-tenant model wired up yet (roadmap phase 3, architecture v3 §9) —
// a fixed tenant segment is used everywhere for now.
const TENANT = 'default';

/** Transient network drops reconnect on their own; credentials are re-minted separately. */
const RECONNECT_PERIOD_MS = 2000;

// The backend publishes the full envelope unchanged to the live topic
// (MeasurementIngestService.publishLiveEvent), so a live message has exactly
// the same shape — snake_case device_id included — as what was ingested.
export type LiveMeasurement = MeasurementEnvelope;

export type LiveListener = (measurement: LiveMeasurement) => void;

interface LiveSession {
  client: MqttClient;
  /** `users.id` as returned by the credential mint — never a client-side value. */
  userId: string;
}

let sharedSession: LiveSession | null = null;
let opening: Promise<LiveSession> | null = null;
/** At most one credential re-mint per unhealthy stretch; reset on a good connect. */
let remintUsed = false;
const listeners = new Set<LiveListener>();

function liveTopic(userId: string): string {
  return `live/${userId}/#`;
}

async function openSession(): Promise<LiveSession> {
  const [credentials, { default: mqtt }] = await Promise.all([api.mintLiveCredentials(), import('mqtt')]);
  const client = mqtt.connect(mqttWsUrl(), {
    // The broker identifies the account by username; the random suffix only
    // keeps two tabs of the same user from evicting each other's connection.
    clientId: `web-${credentials.userId}-${Math.random().toString(16).slice(2, 10)}`,
    username: credentials.username,
    password: credentials.password,
    reconnectPeriod: RECONNECT_PERIOD_MS,
    clean: true,
  });
  const session: LiveSession = { client, userId: credentials.userId };

  client.on('connect', () => {
    remintUsed = false;
    // (Re)assert the subscription on every connect, including reconnects.
    if (listeners.size > 0) client.subscribe(liveTopic(session.userId));
  });

  client.on('message', (_topic: string, payload: Uint8Array) => {
    let measurement: LiveMeasurement;
    try {
      measurement = JSON.parse(new TextDecoder().decode(payload)) as LiveMeasurement;
    } catch {
      // malformed live-feed message — ignore, the durable upload path is unaffected
      return;
    }
    for (const listener of listeners) listener(measurement);
  });

  client.on('error', () => {
    void remintAfterFailure(session);
  });

  return session;
}

/**
 * A refused CONNACK (rotated password, deleted client) or a failed socket:
 * throw the session away and mint a fresh credential, once. Doing it more than
 * once per outage would turn a broker that is simply down into an API flood.
 */
async function remintAfterFailure(failed: LiveSession): Promise<void> {
  if (sharedSession !== failed || remintUsed) return;
  remintUsed = true;
  sharedSession = null;
  failed.client.removeAllListeners();
  failed.client.end(true);
  try {
    await session();
  } catch {
    // API unreachable too — the next publish/subscribe tries again.
  }
}

function session(): Promise<LiveSession> {
  if (sharedSession) return Promise.resolve(sharedSession);
  opening ??= openSession()
    .then((opened) => {
      sharedSession = opened;
      return opened;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

/**
 * Publishes one reading on the primary path. Rejects if no credential can be
 * minted or the broker is unreachable — callers that need a guaranteed
 * delivery path should also call `api.uploadMeasurement()` as the REST
 * fallback, which is what ConnectPage does.
 */
export async function publishMeasurement(envelope: MeasurementEnvelope): Promise<void> {
  const { client, userId } = await session();
  const topic = `v1/${TENANT}/${userId}/${envelope.device_id}/measurement/${envelope.type}`;
  client.publish(topic, JSON.stringify(envelope), { qos: 1 });
}

/**
 * Subscribes to this user's own live feed. The topic is built from the
 * server-asserted id in the minted credential, so there is no id to pass in
 * and no way to ask for somebody else's feed (the broker ACL enforces the same
 * thing independently).
 *
 * Returns the unsubscribe function synchronously, so it can be used as a
 * `useEffect` cleanup even though the session opens asynchronously.
 */
export function subscribeLive(onMessage: LiveListener): () => void {
  listeners.add(onMessage);

  void session()
    .then(({ client, userId }) => {
      // The 'connect' handler covers the not-yet-connected case (and every
      // later reconnect); this covers joining an already-live session.
      if (listeners.has(onMessage) && client.connected) client.subscribe(liveTopic(userId));
    })
    .catch(() => {
      // No credential / no broker — the live panel simply stays empty; the
      // durable REST upload path is independent of this.
    });

  return () => {
    listeners.delete(onMessage);
    if (listeners.size === 0 && sharedSession) {
      sharedSession.client.unsubscribe(liveTopic(sharedSession.userId));
    }
  };
}

/**
 * Drops the broker session and the credential behind it. Called on sign-out so
 * a signed-out tab cannot keep publishing or receiving; also the reset hook for
 * tests.
 */
export function closeLiveSession(): void {
  listeners.clear();
  remintUsed = false;
  opening = null;
  if (sharedSession) {
    sharedSession.client.removeAllListeners();
    sharedSession.client.end(true);
    sharedSession = null;
  }
}
