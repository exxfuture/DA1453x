import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { Card } from './Card';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the number — the window it covers, or a caveat. */
  hint?: string;
  /** Optional leading glyph; `lucide-react` is the app's only icon set. */
  icon?: LucideIcon;
  /**
   * `danger` is for a count that is itself the alert (patients running a fever),
   * never for an ordinary number that happens to be large.
   */
  tone?: 'default' | 'danger';
  /**
   * Numeral size. `sm` (h3) suits a five-across summary row, `md` (h2) the
   * doctor's dense fleet strips, `lg` (h1) the admin analytics strips.
   */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const VALUE_SIZE = {
  sm: 'text-h3',
  md: 'text-h2',
  lg: 'text-h1',
} as const;

/**
 * One number with its label — the unit every analytics strip on the admin and
 * doctor pages is built from.
 *
 * Lives in the shared kit because it previously existed three times over
 * (pages/admin/AdminUi.tsx, EventsPage, DoctorDashboardPage) with the same
 * structure and slightly different props; this is the union of the three
 * (review FE-16 / FE-26).
 *
 * Deliberately plainer than the customer-facing StatCard: these are counts, not
 * readings, so the value keeps an ink token and never borrows a
 * temperature-tier color (those stay reserved for clinical state) — the one
 * exception being `tone="danger"`, where the count *is* the warning.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  size = 'md',
  className,
}: StatTileProps) {
  const danger = tone === 'danger';
  return (
    <Card
      density="compact"
      className={cn(danger && 'border border-danger-border', className)}
    >
      <div className="flex items-center gap-2 text-ink-muted">
        {Icon && <Icon className={cn('size-4', danger && 'text-danger-text')} aria-hidden />}
        <span className="text-label uppercase tracking-wide">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 font-display font-tabular font-semibold',
          VALUE_SIZE[size],
          danger ? 'text-danger-text' : 'text-ink-primary',
        )}
      >
        {value}
      </div>
      {hint && <p className="mt-0.5 text-caption text-ink-muted">{hint}</p>}
    </Card>
  );
}

/** Responsive row of StatTiles — two up on phones, four on a desk. */
export function StatTileGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>;
}
