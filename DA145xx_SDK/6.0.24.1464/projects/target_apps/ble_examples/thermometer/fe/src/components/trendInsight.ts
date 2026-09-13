import { getTemperatureTier } from '../theme/temperature';

/**
 * Pure math behind TrendInsightCard — the customer dashboard's "how am I
 * doing?" summary. Kept out of the component so the period-splitting and
 * day-streak rules are directly testable.
 *
 * Everything here is derived from the readings the dashboard has already
 * fetched: no extra API call, and therefore no data older than the selected
 * range. That constrains the "vs. last period" comparison to the two halves
 * of the current window rather than a genuinely prior fetch — see
 * computeTrendInsight().
 */

export interface InsightReading {
  /** Epoch ms. */
  ts: number;
  /** Raw Celsius — tier classification always uses this, never a display value. */
  celsius: number;
}

export interface TrendComparison {
  recentAvgCelsius: number;
  priorAvgCelsius: number;
  /** recent − prior, in °C. Positive means the recent half ran warmer. */
  deltaCelsius: number;
  direction: 'up' | 'down' | 'flat';
  /** Length of each half of the window, in hours — what the copy names. */
  halfHours: number;
}

export interface TrendInsight {
  readingCount: number;
  /** null when either half of the window is too sparse to compare. */
  comparison: TrendComparison | null;
  highest: InsightReading | null;
  lowest: InsightReading | null;
  /** null when the range is too short for a day streak to mean anything. */
  normalDayStreak: number | null;
}

/** Below this the two halves are called "about the same" — sensor noise, not a trend. */
export const FLAT_DELTA_CELSIUS = 0.1;

/** Each half needs at least this many readings before an average is worth showing. */
const MIN_READINGS_PER_HALF = 2;

/** A "days in normal range" streak is meaningless inside a range shorter than this. */
export const MIN_STREAK_WINDOW_HOURS = 48;

const HOUR_MS = 3_600_000;

function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function previousLocalDay(dayStart: number): number {
  const date = new Date(dayStart);
  // Constructed from parts rather than subtracting 86 400 000 ms so DST
  // transitions (23 h / 25 h days) still land on the previous calendar day.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime();
}

function average(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Consecutive calendar days, counting back from the most recent day that has
 * readings, on which *every* reading classified as Normal.
 *
 * A calendar day with no readings at all ends the streak rather than being
 * skipped: the device reports every few seconds when it is on, so a missing
 * day means we simply do not know how that day went, and claiming it as part
 * of a healthy streak would overstate what the data says.
 */
function computeNormalDayStreak(readings: InsightReading[]): number {
  const allNormalByDay = new Map<number, boolean>();
  for (const reading of readings) {
    const day = startOfLocalDay(reading.ts);
    const isNormal = getTemperatureTier(reading.celsius).tier === 'normal';
    allNormalByDay.set(day, (allNormalByDay.get(day) ?? true) && isNormal);
  }
  if (allNormalByDay.size === 0) return 0;

  let day = Math.max(...allNormalByDay.keys());
  let streak = 0;
  while (allNormalByDay.get(day) === true) {
    streak += 1;
    day = previousLocalDay(day);
  }
  return streak;
}

/**
 * Summarises a window of readings for the dashboard insight card.
 *
 * The comparison splits the *selected range* in half and compares the recent
 * half against the one before it (e.g. on a 7-day range: the last 3.5 days
 * vs. the 3.5 before them). This is deliberately not "this week vs. last
 * week" — the dashboard only ever fetches the selected range, and inventing a
 * second fetch for a summary line is not worth the request.
 *
 * @param readings readings inside the window, in any order.
 * @param rangeHours the window the readings were fetched for.
 * @param now end of the window; injectable for tests.
 */
export function computeTrendInsight(
  readings: InsightReading[],
  rangeHours: number,
  now: number = Date.now(),
): TrendInsight {
  const usable = readings.filter((reading) => Number.isFinite(reading.celsius));

  let highest: InsightReading | null = null;
  let lowest: InsightReading | null = null;
  for (const reading of usable) {
    if (!highest || reading.celsius > highest.celsius) highest = reading;
    if (!lowest || reading.celsius < lowest.celsius) lowest = reading;
  }

  const windowStart = now - rangeHours * HOUR_MS;
  const midpoint = now - (rangeHours / 2) * HOUR_MS;
  const recent: number[] = [];
  const prior: number[] = [];
  for (const reading of usable) {
    if (reading.ts >= midpoint) recent.push(reading.celsius);
    else if (reading.ts >= windowStart) prior.push(reading.celsius);
  }

  let comparison: TrendComparison | null = null;
  if (recent.length >= MIN_READINGS_PER_HALF && prior.length >= MIN_READINGS_PER_HALF) {
    const recentAvgCelsius = average(recent);
    const priorAvgCelsius = average(prior);
    const deltaCelsius = recentAvgCelsius - priorAvgCelsius;
    comparison = {
      recentAvgCelsius,
      priorAvgCelsius,
      deltaCelsius,
      direction:
        Math.abs(deltaCelsius) < FLAT_DELTA_CELSIUS ? 'flat' : deltaCelsius > 0 ? 'up' : 'down',
      halfHours: rangeHours / 2,
    };
  }

  return {
    readingCount: usable.length,
    comparison,
    highest,
    lowest,
    normalDayStreak: rangeHours >= MIN_STREAK_WINDOW_HOURS ? computeNormalDayStreak(usable) : null,
  };
}
