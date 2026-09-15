import { PatientEventsResponse, TemperatureEventResponse } from '../api/client';
import { TemperatureSeriesPoint } from '../components/temperatureWindow';
import { getTemperatureTier, TemperatureTier } from '../theme/temperature';
import { formatDuration } from './time';

/**
 * Pure shaping behind the doctor's fleet event feed and printable report.
 * Kept out of the pages (same split as temperatureWindow.ts ↔
 * TemperatureChart.tsx) so the parts that can silently go wrong — collapsing a
 * per-device feed into per-patient rows, bucketing a 5 s reading stream — are
 * testable without rendering anything.
 */

export interface PatientFeed {
  patientUserId: string;
  patientUsername: string | null;
  /** How many of this patient's devices appear in the feed. */
  deviceCount: number;
  events: TemperatureEventResponse[];
}

/**
 * `GET /api/events/patients` returns one row per **device**, so a patient with
 * two thermometers appears twice. Merging by patient id is what makes the feed
 * read as "patients" and keeps the affected-patient count honest.
 */
export function groupByPatient(rows: PatientEventsResponse[]): PatientFeed[] {
  const byPatient = new Map<string, PatientFeed>();
  for (const row of rows) {
    let feed = byPatient.get(row.patientUserId);
    if (!feed) {
      feed = {
        patientUserId: row.patientUserId,
        patientUsername: row.patientUsername,
        deviceCount: 0,
        events: [],
      };
      byPatient.set(row.patientUserId, feed);
    }
    if (row.deviceBdAddr) feed.deviceCount += 1;
    feed.events.push(...row.events);
  }
  return [...byPatient.values()];
}

/**
 * Human-readable length of an episode, from its two instants.
 *
 * Delegates to the one elapsed-time formatter (review FE-25) instead of the
 * third convention this file used to carry — a `(startMs, endMs)` signature that
 * rendered "2.5 h" where the customer's history rendered "2 h 30 min" for the
 * same episode. Kept as a named helper because the call sites hold a start and
 * an end, not a difference.
 */
export function durationText(startMs: number, endMs: number): string {
  return formatDuration(Math.max(0, endMs - startMs));
}

/** Bucket width for the report's readings table, chosen so a report is ~20-30 rows. */
export function bucketMsFor(rangeHours: number): number {
  if (rangeHours <= 24) return 3_600_000;
  if (rangeHours <= 24 * 7) return 6 * 3_600_000;
  return 24 * 3_600_000;
}

export interface ReadingBucket {
  startMs: number;
  count: number;
  minCelsius: number;
  maxCelsius: number;
  avgCelsius: number;
  /** Tier of the bucket's peak — the clinically interesting one. */
  peakTier: TemperatureTier;
}

/**
 * Collapses raw readings (5 s cadence — tens of thousands over a week) into
 * fixed time buckets. A per-reading table would be unreadable on screen and
 * unprintable on paper.
 */
export function bucketReadings(points: TemperatureSeriesPoint[], bucketMs: number): ReadingBucket[] {
  const buckets = new Map<number, { sum: number; count: number; min: number; max: number }>();
  for (const point of points) {
    const key = Math.floor(point.ts / bucketMs) * bucketMs;
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { sum: point.celsius, count: 1, min: point.celsius, max: point.celsius });
      continue;
    }
    bucket.sum += point.celsius;
    bucket.count += 1;
    if (point.celsius < bucket.min) bucket.min = point.celsius;
    if (point.celsius > bucket.max) bucket.max = point.celsius;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startMs, bucket]) => ({
      startMs,
      count: bucket.count,
      minCelsius: bucket.min,
      maxCelsius: bucket.max,
      avgCelsius: bucket.sum / bucket.count,
      peakTier: getTemperatureTier(bucket.max).tier,
    }));
}
