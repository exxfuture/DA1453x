import { type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the number — the window it covers, or a caveat. */
  hint?: string;
  className?: string;
}

/**
 * One number with its label — the unit every admin analytics strip is built
 * from.
 *
 * Deliberately plainer than the customer-facing StatCard: these are counts,
 * not readings, so the value keeps an ink token and never borrows a
 * temperature-tier or status color (those stay reserved for clinical state
 * and for good/warning/danger, and a count is neither).
 */
export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-surface-1 p-4 shadow-sm dark:shadow-none dark:border dark:border-border-hairline/[0.08]',
        className,
      )}
    >
      <div className="text-label uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-display font-tabular text-h1 text-ink-primary">{value}</div>
      {hint && <p className="mt-0.5 text-caption text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Responsive row of StatTiles — two up on phones, four on a desk. */
export function StatTileGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group — the buttons alone don't say what they switch. */
  label: string;
  className?: string;
}

/**
 * Mutually exclusive view switch, styled like the range pickers on the doctor
 * pages so the two read as the same control.
 */
export function Segmented<T extends string>({ options, value, onChange, label, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1', className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? 'primary' : 'tertiary'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The denominator for the magnitude bars in the breakdown tables: the largest
 * row, never the sum.
 *
 * Every breakdown on these pages is capped server-side (LIMIT 100), so the
 * rows in hand aren't guaranteed to add up to anything — "share of the
 * biggest row" is the only comparison that stays true of a truncated list.
 * Floored at 1 so an all-zero list can't divide by zero.
 */
export function largestOf(counts: number[]): number {
  return Math.max(1, ...counts);
}
