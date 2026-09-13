import { describe, expect, it } from 'vitest';
import {
  computeYDomain,
  mergeSeries,
  nearestIndex,
  resolveWindow,
  shiftWindow,
  type TemperatureSeries,
} from './temperatureWindow';

const MINUTE = 60_000;

function series(id: string, points: Array<[number, number]>): TemperatureSeries {
  return {
    id,
    label: id,
    color: '#000000',
    points: points.map(([ts, celsius]) => ({ ts, celsius, value: celsius })),
  };
}

describe('mergeSeries', () => {
  it('merges series onto one sorted, de-duplicated timeline', () => {
    const rows = mergeSeries([
      series('a', [
        [2 * MINUTE, 37],
        [0, 36.5],
      ]),
      series('b', [
        [MINUTE, 38],
        [2 * MINUTE, 38.5],
      ]),
    ]);

    expect(rows.map((r) => r.ts)).toEqual([0, MINUTE, 2 * MINUTE]);
    expect(rows[0].points.a?.celsius).toBe(36.5);
    expect(rows[0].points.b).toBeUndefined();
    expect(rows[2].points.a?.celsius).toBe(37);
    expect(rows[2].points.b?.celsius).toBe(38.5);
  });

  it('returns an empty timeline for empty series', () => {
    expect(mergeSeries([series('a', [])])).toEqual([]);
  });
});

describe('nearestIndex', () => {
  const rows = mergeSeries([series('a', [[0, 36], [MINUTE, 36], [2 * MINUTE, 36]])]);

  it('snaps to the closest timestamp, including out-of-range ones', () => {
    expect(nearestIndex(rows, -10 * MINUTE)).toBe(0);
    expect(nearestIndex(rows, MINUTE - 1)).toBe(1);
    expect(nearestIndex(rows, MINUTE + 100)).toBe(1);
    expect(nearestIndex(rows, 10 * MINUTE)).toBe(2);
  });
});

describe('resolveWindow', () => {
  const points: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [i * MINUTE, 36.5]);
  const rows = mergeSeries([series('a', points)]);

  it('follows the full extent when no zoom is set', () => {
    const resolved = resolveWindow(rows, null);
    expect(resolved).toMatchObject({ startIndex: 0, endIndex: 9, start: 0, end: 9 * MINUTE });
  });

  it('is safe on an empty timeline', () => {
    expect(resolveWindow([], [0, MINUTE])).toMatchObject({ startIndex: 0, endIndex: 0, start: 0, end: 0 });
    expect(resolveWindow([], null)).toMatchObject({ startIndex: 0, endIndex: 0, start: 0, end: 0 });
  });

  it('reports a degenerate window for a lone reading, zoomed or not', () => {
    // One row cannot produce a window with width: there is nothing to widen
    // to. Both branches therefore collapse onto that single instant, and the
    // caller must refuse to render — TemperatureChart bails out below two rows
    // rather than handing recharts a zero-width X domain.
    const single = mergeSeries([series('a', [[5 * MINUTE, 37]])]);

    for (const zoom of [null, [0, 10 * MINUTE] as [number, number]]) {
      const resolved = resolveWindow(single, zoom);
      expect(resolved).toMatchObject({ startIndex: 0, endIndex: 0, start: 5 * MINUTE, end: 5 * MINUTE });
      expect(resolved.end - resolved.start).toBe(0);
    }
  });

  it('keeps the same instants visible after the rolling window slides', () => {
    // The user brushes minutes 3-6, then a refetch drops the two oldest rows
    // and appends two newer ones — the same *timestamps* must stay selected
    // even though their indices shifted by two.
    const zoom: [number, number] = [3 * MINUTE, 6 * MINUTE];
    const before = resolveWindow(rows, zoom);
    expect(before).toMatchObject({ startIndex: 3, endIndex: 6 });

    const slid = mergeSeries([
      series(
        'a',
        Array.from({ length: 10 }, (_, i): [number, number] => [(i + 2) * MINUTE, 36.5]),
      ),
    ]);
    const after = resolveWindow(slid, zoom);
    expect(after).toMatchObject({ startIndex: 1, endIndex: 4 });
    expect([after.start, after.end]).toEqual([3 * MINUTE, 6 * MINUTE]);
  });

  it('clamps a window that has aged out of the data instead of vanishing', () => {
    const fresh = mergeSeries([
      series(
        'a',
        Array.from({ length: 5 }, (_, i): [number, number] => [(i + 100) * MINUTE, 36.5]),
      ),
    ]);
    const resolved = resolveWindow(fresh, [0, MINUTE]);
    // Both edges snap to the oldest surviving row; the window is widened to a
    // non-zero span so the chart still has something to draw.
    expect(resolved.startIndex).toBe(0);
    expect(resolved.endIndex).toBe(1);
  });
});

describe('shiftWindow', () => {
  const rows = mergeSeries([
    series(
      'a',
      Array.from({ length: 21 }, (_, i): [number, number] => [i * MINUTE, 36.5]),
    ),
  ]);

  it('moves by a quarter of the window width, preserving the width', () => {
    const resolved = resolveWindow(rows, [4 * MINUTE, 8 * MINUTE]);
    expect(shiftWindow(resolved, 1)).toEqual([5 * MINUTE, 9 * MINUTE]);
    expect(shiftWindow(resolved, -1)).toEqual([3 * MINUTE, 7 * MINUTE]);
  });

  it('clamps at both extents without shrinking the window', () => {
    const atStart = resolveWindow(rows, [0, 4 * MINUTE]);
    expect(shiftWindow(atStart, -1)).toEqual([0, 4 * MINUTE]);

    const atEnd = resolveWindow(rows, [16 * MINUTE, 20 * MINUTE]);
    expect(shiftWindow(atEnd, 1)).toEqual([16 * MINUTE, 20 * MINUTE]);
  });

  it('returns null when there is no width to shift', () => {
    expect(shiftWindow(resolveWindow([], null), 1)).toBeNull();
    const single = mergeSeries([series('a', [[5 * MINUTE, 37]])]);
    expect(shiftWindow(resolveWindow(single, null), 1)).toBeNull();
  });
});

describe('computeYDomain', () => {
  const a = series('a', [
    [0, 36.0],
    [MINUTE, 36.4],
    [2 * MINUTE, 39.8],
  ]);

  it('only considers readings inside the window', () => {
    const [min, max] = computeYDomain([a], 0, MINUTE, 'CELSIUS') as [number, number];
    // Span is 0.4 °C, so the 0.3 °C padding floor wins over 12% of the span.
    expect(min).toBeCloseTo(35.7, 5);
    expect(max).toBeCloseTo(36.7, 5);
  });

  it('zooms out to a spike that enters the window', () => {
    const [min, max] = computeYDomain([a], 0, 2 * MINUTE, 'CELSIUS') as [number, number];
    expect(min).toBeCloseTo(36.0 - 3.8 * 0.12, 5);
    expect(max).toBeCloseTo(39.8 + 3.8 * 0.12, 5);
  });

  it('scales the padding floor for Fahrenheit', () => {
    const f: TemperatureSeries = { ...a, points: a.points.map((p) => ({ ...p, value: (p.celsius * 9) / 5 + 32 })) };
    const [min, max] = computeYDomain([f], 0, 0, 'FAHRENHEIT') as [number, number];
    expect(max - min).toBeCloseTo(2 * ((0.3 * 9) / 5), 5);
  });

  it('spans every series in a multi-series overlay', () => {
    const b = series('b', [[MINUTE, 41.0]]);
    const [, max] = computeYDomain([a, b], 0, MINUTE, 'CELSIUS') as [number, number];
    expect(max).toBeGreaterThan(41);
  });

  it('still spans a usable range for a lone reading', () => {
    // Only the X domain degenerates on a single row (see resolveWindow above);
    // the Y domain keeps the padding floor on both sides of the reading.
    const [min, max] = computeYDomain([series('one', [[0, 37]])], 0, 0, 'CELSIUS') as [number, number];
    expect(min).toBeCloseTo(36.7, 5);
    expect(max).toBeCloseTo(37.3, 5);
  });

  it('returns null when the window holds no readings', () => {
    expect(computeYDomain([a], 10 * MINUTE, 20 * MINUTE, 'CELSIUS')).toBeNull();
  });
});
