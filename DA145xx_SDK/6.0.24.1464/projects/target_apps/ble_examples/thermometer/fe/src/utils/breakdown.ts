/**
 * The denominator for the magnitude bars in the breakdown tables: the largest
 * row, never the sum.
 *
 * Every breakdown on the admin pages is capped server-side (LIMIT 100), so the
 * rows in hand aren't guaranteed to add up to anything — "share of the biggest
 * row" is the only comparison that stays true of a truncated list. Floored at 1
 * so an all-zero list can't divide by zero.
 *
 * Lives in utils/ rather than under pages/admin/ (review FE-26): it is plain
 * arithmetic with no admin-specific knowledge, and the module it used to share
 * with StatTile/Segmented was exactly what kept those generic components out of
 * the shared kit.
 */
export function largestOf(counts: number[]): number {
  return Math.max(1, ...counts);
}
