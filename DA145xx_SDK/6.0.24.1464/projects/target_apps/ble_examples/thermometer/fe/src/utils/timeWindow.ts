/**
 * The time range a history view (chart, episode timeline, notes list) is
 * scoped to — either a rolling "last N hours" that keeps sliding with the
 * clock, or a fixed instant-to-instant range the user picked explicitly.
 * Every history query hook (`useMeasurementHistory`, `useDeviceEvents`,
 * `useAnnotations`, `useMeasurementHistories`) takes one of these instead of
 * a raw `rangeHours: number`, so a custom range flows through the same code
 * path as a preset everywhere it's used.
 */
export type TimeWindow = { kind: 'sliding'; hours: number } | { kind: 'custom'; from: string; to: string };

/**
 * Resolves a window to concrete ISO instants. For `sliding`, computed fresh
 * on every call (not memoized) so a mount + refetchInterval tick keeps "last
 * N hours" moving with the clock instead of freezing at first render — same
 * behavior the inline `slidingWindow()` helpers this replaces already had.
 */
export function resolveTimeWindow(window: TimeWindow): { from: string; to: string } {
  if (window.kind === 'custom') {
    return { from: window.from, to: window.to };
  }
  const to = new Date();
  const from = new Date(to.getTime() - window.hours * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Stable, serializable fragment for a React Query key or a remount `key`. */
export function timeWindowKey(window: TimeWindow): string {
  return window.kind === 'sliding' ? `sliding:${window.hours}` : `custom:${window.from}:${window.to}`;
}

/** Elapsed hours the window actually spans — sliding windows know this
 *  directly; a custom window derives it from its fixed endpoints. */
export function timeWindowHours(window: TimeWindow): number {
  if (window.kind === 'sliding') return window.hours;
  const ms = new Date(window.to).getTime() - new Date(window.from).getTime();
  return Math.max(ms / 3_600_000, 0);
}

/** Short label for display (button state, CSV filenames) — presets keep
 *  their familiar "24h"/"7d" form, a custom range gets a generic label. */
export function timeWindowLabel(window: TimeWindow, presetLabel?: string): string {
  if (window.kind === 'sliding' && presetLabel) return presetLabel;
  if (window.kind === 'sliding') return `${window.hours}h`;
  return 'custom';
}
