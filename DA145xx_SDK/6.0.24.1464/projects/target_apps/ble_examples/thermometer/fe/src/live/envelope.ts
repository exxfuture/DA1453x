/**
 * The measurement envelope this app puts on the wire.
 *
 * The format is NOT defined here: `../../../schema/measurement-envelope.v1.schema.json`
 * (JSON Schema 2020-12) is the single source of truth shared with the Go
 * gateway (`gateway/internal/envelope`) and the Java backend
 * (`ingest/MeasurementEnvelope`) — review INF-07. `envelope.test.ts` validates
 * what `buildTemperatureEnvelope()` produces against that file, read from disk,
 * so a field rename on any side fails a test instead of silently desyncing.
 * Change the schema first, then the three implementations.
 *
 * Built here rather than inline in ConnectPage so exactly one place decides
 * what a published reading looks like, and so that place is testable.
 */

export interface MeasurementEnvelope {
  /** Envelope version. Only 1 exists. */
  v: number;
  /** The device's Bluetooth address as this collector saw it (≤ 17 chars). */
  device_id: string;
  /** Which collector produced the reading. */
  collector_id: string;
  /** Reading instant, RFC 3339 with offset. */
  ts: string;
  /** Measurement type; `temperature` is the only one this app publishes. */
  type: string;
  payload: Record<string, unknown>;
  /** Optional collector-side context (battery, RSSI, firmware) — omitted, never null. */
  meta?: Record<string, unknown>;
}

/**
 * `collector_id` of this web app, as it appears in `measurements.collector_id`
 * and in the admin console's collector breakdown. The mobile Capacitor shell
 * runs this same code, so it reports the same id — the distinction that matters
 * downstream is browser-vs-gateway, not browser-vs-phone.
 */
export const WEB_COLLECTOR_ID = 'web-fe';

/**
 * One temperature reading, ready to publish over MQTT or upload over REST.
 *
 * `celsius` must be a finite number: the IEEE-11073 decoder returns `null` for
 * the reserved NaN/NRes/±Inf sentinels (see ../ble/ieee11073.ts, review FE-04)
 * and callers drop those before they get here, so a sensor fault never reaches
 * the wire as a plausible-looking reading.
 */
export function buildTemperatureEnvelope(
  deviceId: string,
  celsius: number,
  ts: Date = new Date(),
): MeasurementEnvelope {
  return {
    v: 1,
    device_id: deviceId,
    collector_id: WEB_COLLECTOR_ID,
    ts: ts.toISOString(),
    type: 'temperature',
    payload: { celsius },
  };
}
