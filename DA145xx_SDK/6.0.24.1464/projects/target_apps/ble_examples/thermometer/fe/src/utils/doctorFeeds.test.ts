import { describe, expect, it } from 'vitest';
import { PatientEventsResponse } from '../api/client';
import { bucketMsFor, bucketReadings, durationText, groupByPatient } from './doctorFeeds';

function event(startTs: string, peakCelsius: number) {
  return {
    deviceBdAddr: 'AA:BB',
    tier: 'fever' as const,
    startTs,
    endTs: startTs,
    peakCelsius,
    readingCount: 3,
  };
}

describe('groupByPatient', () => {
  it('merges the per-device rows of one patient into a single feed', () => {
    const rows: PatientEventsResponse[] = [
      {
        patientUserId: 'p1',
        patientUsername: 'ann',
        deviceBdAddr: 'AA:BB',
        events: [event('2026-01-01T10:00:00Z', 39)],
      },
      {
        patientUserId: 'p1',
        patientUsername: 'ann',
        deviceBdAddr: 'CC:DD',
        events: [event('2026-01-01T12:00:00Z', 38.4)],
      },
      { patientUserId: 'p2', patientUsername: 'bob', deviceBdAddr: 'EE:FF', events: [] },
    ];

    const feeds = groupByPatient(rows);

    expect(feeds).toHaveLength(2);
    expect(feeds[0].patientUserId).toBe('p1');
    expect(feeds[0].deviceCount).toBe(2);
    expect(feeds[0].events).toHaveLength(2);
    expect(feeds[1].events).toHaveLength(0);
  });

  it('does not count a patient without a device as having one', () => {
    const feeds = groupByPatient([
      { patientUserId: 'p1', patientUsername: null, deviceBdAddr: null, events: [] },
    ]);
    expect(feeds[0].deviceCount).toBe(0);
  });

  it('returns nothing for an empty feed', () => {
    expect(groupByPatient([])).toEqual([]);
  });
});

describe('durationText', () => {
  // Now the shared utils/time#formatDuration convention (review FE-25), so the
  // doctor's feed and the customer's history word the same episode identically:
  // "1 h 30 min", not "1.5 h" on one page and "1 h 30 min" on the other.
  it('reports short episodes in minutes and longer ones in hours + minutes', () => {
    expect(durationText(0, 45 * 60_000)).toBe('45 min');
    expect(durationText(0, 90 * 60_000)).toBe('1 h 30 min');
    expect(durationText(0, 120 * 60_000)).toBe('2 h');
  });

  it('never reports a negative duration', () => {
    // Clamped to zero, which the formatter's 1-minute floor renders as "1 min".
    expect(durationText(60_000, 0)).toBe('1 min');
  });
});

describe('bucketMsFor', () => {
  it('widens the bucket with the range so the table stays a readable length', () => {
    expect(bucketMsFor(24)).toBe(3_600_000);
    expect(bucketMsFor(24 * 7)).toBe(6 * 3_600_000);
    expect(bucketMsFor(24 * 30)).toBe(24 * 3_600_000);
  });
});

describe('bucketReadings', () => {
  const point = (ts: number, celsius: number) => ({ ts, celsius, value: celsius });

  it('aggregates readings into fixed windows, oldest first', () => {
    const hour = 3_600_000;
    const buckets = bucketReadings(
      [
        point(hour * 2 + 10, 36.5),
        point(hour * 2 + 20, 37.4),
        point(hour + 5, 38.0),
        point(hour + 10, 40.0),
      ],
      hour,
    );

    expect(buckets.map((b) => b.startMs)).toEqual([hour, hour * 2]);
    expect(buckets[0]).toMatchObject({ count: 2, minCelsius: 38.0, maxCelsius: 40.0, avgCelsius: 39.0 });
    // The tier describes the bucket's peak, not its average.
    expect(buckets[0].peakTier).toBe('highFever');
    expect(buckets[1]).toMatchObject({ count: 2, minCelsius: 36.5, maxCelsius: 37.4 });
    expect(buckets[1].peakTier).toBe('normal');
  });

  it('handles an empty reading list', () => {
    expect(bucketReadings([], 3_600_000)).toEqual([]);
  });
});
