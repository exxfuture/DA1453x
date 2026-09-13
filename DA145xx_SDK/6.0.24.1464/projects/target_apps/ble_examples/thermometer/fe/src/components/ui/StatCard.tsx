import { cn } from './cn';
import { TemperatureBadge, ConnectionBadge, type ConnectionState } from './Badge';
import { getTemperatureTier } from '../../theme/temperature';
import { TemperatureUnit } from '../../api/client';
import { convertFromCelsius, unitSuffix } from '../../utils/temperature';
import { relativeTime } from '../../utils/time';

const TIER_WASH: Record<string, string> = {
  low: 'bg-[radial-gradient(circle_at_top,rgb(var(--color-temp-low-text)/0.06),transparent_70%)]',
  normal: 'bg-[radial-gradient(circle_at_top,rgb(var(--color-temp-normal-text)/0.06),transparent_70%)]',
  elevated: 'bg-[radial-gradient(circle_at_top,rgb(var(--color-temp-elevated-text)/0.06),transparent_70%)]',
  fever: 'bg-[radial-gradient(circle_at_top,rgb(var(--color-temp-fever-text)/0.06),transparent_70%)]',
  highFever: 'bg-[radial-gradient(circle_at_top,rgb(var(--color-temp-high-fever-text)/0.08),transparent_70%)]',
};

const TIER_TEXT_CLASS: Record<string, string> = {
  low: 'text-temp-low-text',
  normal: 'text-temp-normal-text',
  elevated: 'text-temp-elevated-text',
  fever: 'text-temp-fever-text',
  highFever: 'text-temp-high-fever-text',
};

export interface StatCardProps {
  label: string;
  celsius: number | null;
  updatedAt: Date | null;
  /** Omit when there's no live BLE session to report on (e.g. a
   *  history-backed reading with no active connection in this tab). */
  connection?: ConnectionState;
  /** Display unit — defaults to Celsius. Tier classification always uses the raw Celsius value. */
  unit?: TemperatureUnit;
  className?: string;
}

/** The hero live-reading card — see design spec §4 "StatCard". */
export function StatCard({ label, celsius, updatedAt, connection, unit = 'CELSIUS', className }: StatCardProps) {
  const tierInfo = celsius != null ? getTemperatureTier(celsius) : null;
  const displayValue = celsius != null ? convertFromCelsius(celsius, unit) : null;

  return (
    <div
      className={cn(
        'rounded-xl bg-surface-1 p-6 sm:p-8 shadow-md dark:shadow-none dark:border dark:border-border-hairline/[0.08]',
        tierInfo && TIER_WASH[tierInfo.tier],
        className,
      )}
    >
      <div className="text-label uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1 font-tabular">
        {displayValue != null ? (
          <>
            <span
              className={cn(
                'font-display text-hero-2 sm:text-hero-1 transition-opacity duration-base ease-standard',
                tierInfo && TIER_TEXT_CLASS[tierInfo.tier],
              )}
            >
              {displayValue.toFixed(2)}
            </span>
            <span className="text-h2 text-ink-muted">{unitSuffix(unit)}</span>
          </>
        ) : (
          <span className="font-display text-h1 text-ink-muted">No readings yet</span>
        )}
      </div>
      {tierInfo && (
        <div className="mt-3">
          <TemperatureBadge tier={tierInfo.tier} label={tierInfo.label} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-caption text-ink-muted">
        <span>{updatedAt ? `Updated ${relativeTime(updatedAt)}` : 'No reading yet'}</span>
        {connection && <ConnectionBadge state={connection} />}
      </div>
    </div>
  );
}
