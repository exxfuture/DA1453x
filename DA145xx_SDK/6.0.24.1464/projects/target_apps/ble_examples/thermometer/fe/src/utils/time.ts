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
