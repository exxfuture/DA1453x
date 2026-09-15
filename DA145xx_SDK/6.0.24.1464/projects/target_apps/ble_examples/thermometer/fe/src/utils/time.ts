/**
 * Time formatting, shared so there is one convention per question.
 * `relativeTime()` answers "how long ago?", `formatDuration()` "how long?".
 */

/**
 * Shared "N ago" formatter. Previously reimplemented in StatCard and the
 * doctor dashboard with different granularity — this is the superset
 * (seconds → minutes → hours → days) both now use.
 */
export function relativeTime(
  date: Date | string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (date == null) return 'never';

  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(then)) return 'never';

  // Clamped at 0: a device clock running slightly ahead of the browser's
  // shouldn't render as "in -3s".
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  // Hours stay readable up to two days — "36h ago" is more useful than "2d ago".
  if (hours < 48) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Human-readable *length* of a span, in milliseconds — "45 min", "3 h 20 min",
 * "2 d 6 h".
 *
 * The single formatter for elapsed time (review FE-25). There used to be three,
 * with three different signatures and unit conventions: `formatDuration(hours)`
 * in TrendInsightCard, `formatDuration(ms)` in HistoryPage, and
 * `durationText(startMs, endMs)` in utils/doctorFeeds. Callers that hold hours
 * or a pair of instants convert at the call site, so the units live in one
 * place.
 *
 * Rules, taken from the HistoryPage version because episode lengths are what
 * this mostly renders:
 *  - under an hour: whole minutes, floored at 1 — a 20-second episode reads as
 *    "1 min", never "0 min";
 *  - under a day: hours, plus the leftover minutes when there are any;
 *  - beyond that: days, plus the leftover hours when there are any.
 *
 * `maxUnit: 'hours'` stops at hours ("36 h" rather than "1 d 12 h"), which is
 * what the trend card's period comparison wants — there, the number is the
 * window the reader just chose, so splitting it into days is noise.
 */
export function formatDuration(ms: number, options?: { maxUnit?: 'hours' | 'days' }): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  const stopAtHours = options?.maxUnit === 'hours';
  if (hours < 24 || stopAtHours) {
    return leftoverMinutes === 0 ? `${hours} h` : `${hours} h ${leftoverMinutes} min`;
  }

  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days} d` : `${days} d ${leftoverHours} h`;
}

/** Milliseconds in an hour — so callers holding hours can convert readably. */
export const MS_PER_HOUR = 3_600_000;
