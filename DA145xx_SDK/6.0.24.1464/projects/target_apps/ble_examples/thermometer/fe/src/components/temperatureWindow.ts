import { TemperatureUnit } from '../api/client';

/**
 * Pure window/zoom math behind TemperatureChart. Kept out of the component so
 * the part most likely to break silently — reconciling a timestamp window
 * against a data array that is refetched (and re-based) every few seconds —
 * is directly testable without rendering recharts.
 */

export interface TemperatureSeriesPoint {
  /** Epoch ms. */
  ts: number;
  /** Raw Celsius — tier classification always uses this, never the display value. */
  celsius: number;
  /** Same reading converted to the display unit. */
  value: number;
}

export interface TemperatureSeries {
  id: string;
  label: string;
  color: string;
  points: TemperatureSeriesPoint[];
}

/** One entry per distinct timestamp across all series (recharts wide format). */
export interface MergedRow {
  ts: number;
  points: Record<string, TemperatureSeriesPoint | undefined>;
}

/** Minimum half-padding of the Y axis, in °C — keeps a flat window from
 *  zooming into sensor noise and looking like a rollercoaster. */
export const MIN_Y_PAD_CELSIUS = 0.3;
export const Y_PAD_FRACTION = 0.12;

/** How far a ◀/▶ press moves the window, as a fraction of its width. */
export const STEP_FRACTION = 0.25;

export function mergeSeries(series: TemperatureSeries[]): MergedRow[] {
  const byTs = new Map<number, MergedRow>();
  for (const s of series) {
    for (const point of s.points) {
      let row = byTs.get(point.ts);
      if (!row) {
        row = { ts: point.ts, points: {} };
        byTs.set(point.ts, row);
      }
      row.points[s.id] = point;
    }
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

/** Index of the row whose ts is closest to `ts`. Assumes rows are sorted. */
export function nearestIndex(rows: MergedRow[], ts: number): number {
  if (rows.length === 0) return 0;
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid].ts < ts) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(rows[low - 1].ts - ts) <= Math.abs(rows[low].ts - ts)) return low - 1;
  return low;
}

export interface ResolvedWindow {
  /** Brush index, valid against the rows passed in. */
  startIndex: number;
  endIndex: number;
  /** The timestamps those indices actually land on. */
  start: number;
  end: number;
  /** Full extent of the data, for edge detection. */
  fullStart: number;
  fullEnd: number;
}

/**
 * Translates a timestamp window into Brush indices against the *current* rows.
 *
 * This must be recomputed every render: `useMeasurementHistory` refetches a
 * rolling range every 5s, so index 0 is a different instant on every tick and
 * a previously valid index can fall off the end. Holding raw Brush indices
 * instead would make the visible range drift after a minute of live use.
 *
 * `zoomWindow === null` means "follow the data" — the full current extent.
 */
export function resolveWindow(rows: MergedRow[], zoomWindow: [number, number] | null): ResolvedWindow {
  if (rows.length === 0) {
    return { startIndex: 0, endIndex: 0, start: 0, end: 0, fullStart: 0, fullEnd: 0 };
  }

  const lastIndex = rows.length - 1;
  const fullStart = rows[0].ts;
  const fullEnd = rows[lastIndex].ts;

  if (!zoomWindow) {
    return { startIndex: 0, endIndex: lastIndex, start: fullStart, end: fullEnd, fullStart, fullEnd };
  }

  const startIndex = nearestIndex(rows, zoomWindow[0]);
  // Never collapse to a zero-width window: recharts needs at least two points
  // to draw anything, and a zero-width X domain divides by zero.
  const endIndex = Math.max(nearestIndex(rows, zoomWindow[1]), Math.min(startIndex + 1, lastIndex));

  return {
    startIndex,
    endIndex,
    start: rows[startIndex].ts,
    end: rows[endIndex].ts,
    fullStart,
    fullEnd,
  };
}

/**
 * Shifts the window by STEP_FRACTION of its width, preserving the width and
 * clamping to the data extent. Returns null when there's nowhere to go.
 */
export function shiftWindow(resolved: ResolvedWindow, direction: -1 | 1): [number, number] | null {
  const width = resolved.end - resolved.start;
  if (width <= 0) return null;

  const delta = Math.max(1, Math.round(width * STEP_FRACTION)) * direction;
  let from = resolved.start + delta;
  let to = resolved.end + delta;

  if (from < resolved.fullStart) {
    from = resolved.fullStart;
    to = from + width;
  }
  if (to > resolved.fullEnd) {
    to = resolved.fullEnd;
    from = to - width;
  }
  return [from, to];
}

/**
 * Vertical auto-scale: min/max across every series inside the visible window,
 * plus padding, so a fever spike entering the window zooms the axis onto it.
 * Returns null when the window holds no readings (caller falls back to 'auto').
 *
 * Plain loops rather than Math.min(...values): a 7-day range can hold tens of
 * thousands of points and spreading those blows the argument limit.
 */
export function computeYDomain(
  series: TemperatureSeries[],
  windowStart: number,
  windowEnd: number,
  unit: TemperatureUnit,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const point of s.points) {
      if (point.ts < windowStart || point.ts > windowEnd) continue;
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
  }
  if (min === Infinity) return null;

  // A padding floor expressed in °C has to be scaled (not offset) for °F.
  const minPad = unit === 'FAHRENHEIT' ? (MIN_Y_PAD_CELSIUS * 9) / 5 : MIN_Y_PAD_CELSIUS;
  const pad = Math.max((max - min) * Y_PAD_FRACTION, minPad);
  return [min - pad, max + pad];
}
