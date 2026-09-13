const DAY_MS = 86_400_000;

export interface DailyCount {
  /** ISO instant at the start of the day the count belongs to. */
  day: string;
  count: number;
}

export interface DailyPoint {
  /** Epoch ms at UTC midnight — TrendChart's `x`. */
  x: number;
  y: number;
}

/** The UTC day an instant falls in, as epoch ms at its midnight. */
function utcMidnight(epochMs: number): number {
  return Math.floor(epochMs / DAY_MS) * DAY_MS;
}

/**
 * Expands a sparse daily series into one point per day across the trailing
 * window, filling the gaps with zeroes.
 *
 * The backend groups the rows that exist, so a day nobody signed up on is
 * simply absent from the response. Plotting that as-is draws a straight line
 * between two distant days, which reads as steady growth across a stretch
 * where nothing happened — the one thing the chart must not say.
 *
 * Days outside the window are ignored rather than clamped into the first
 * bucket, and same-day entries are summed (the backend already groups by day,
 * but a server on a non-UTC clock can split one UTC day across two rows).
 */
export function fillDailySeries(points: DailyCount[], days: number, now: number = Date.now()): DailyPoint[] {
  const counts = new Map<number, number>();
  for (const point of points) {
    const parsed = Date.parse(point.day);
    if (Number.isNaN(parsed)) continue;
    const key = utcMidnight(parsed);
    counts.set(key, (counts.get(key) ?? 0) + point.count);
  }

  const today = utcMidnight(now);
  const series: DailyPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = today - offset * DAY_MS;
    series.push({ x: day, y: counts.get(day) ?? 0 });
  }
  return series;
}
