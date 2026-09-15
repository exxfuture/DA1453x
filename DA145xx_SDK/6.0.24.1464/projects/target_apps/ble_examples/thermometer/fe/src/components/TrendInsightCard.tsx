import { useMemo } from 'react';
import { Minus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MeasurementResponse, TemperatureUnit } from '../api/client';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import { formatDuration, MS_PER_HOUR, relativeTime } from '../utils/time';
import { computeTrendInsight, type InsightReading, type TrendComparison } from './trendInsight';
import { Card } from './ui/Card';

export interface TrendInsightCardProps {
  /** The dashboard's already-fetched history — newest-first, as the API returns it. */
  data: MeasurementResponse[];
  unit: TemperatureUnit;
  /** The range those readings were fetched for; drives the period comparison. */
  rangeHours: number;
  className?: string;
}

/** Differences are intervals, so °F conversion scales them — it must not offset by 32. */
function scaleDelta(deltaCelsius: number, unit: TemperatureUnit): number {
  return unit === 'FAHRENHEIT' ? (deltaCelsius * 9) / 5 : deltaCelsius;
}

function formatReading(celsius: number, unit: TemperatureUnit): string {
  return `${convertFromCelsius(celsius, unit).toFixed(2)} ${unitSuffix(unit)}`;
}

const DIRECTION_ICON: Record<TrendComparison['direction'], LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

/**
 * Comparison sentence in plain language. Wording is deliberately descriptive
 * ("higher than", not "worse than") — this is a self-tracking summary, not a
 * clinical assessment.
 */
function comparisonSentence(comparison: TrendComparison, unit: TemperatureUnit): string {
  // The one elapsed-time formatter (review FE-25), converting from the hours
  // this module works in. `maxUnit: 'hours'` because the period is the range the
  // reader just chose — "84 h" reads as the half of a 7-day window it is, where
  // "3 d 12 h" invites arithmetic.
  const period = formatDuration(comparison.halfHours * MS_PER_HOUR, { maxUnit: 'hours' });
  if (comparison.direction === 'flat') {
    return `Your average is holding steady compared with the previous ${period}.`;
  }
  const delta = Math.abs(scaleDelta(comparison.deltaCelsius, unit));
  const word = comparison.direction === 'up' ? 'higher' : 'lower';
  return `Your average is ${delta.toFixed(2)} ${unitSuffix(unit)} ${word} than the previous ${period}.`;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-label uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 font-tabular text-body-lg font-semibold text-ink-primary">{value}</div>
      {detail && <div className="text-caption text-ink-muted">{detail}</div>}
    </div>
  );
}

/**
 * Merged trend + digest card (customer features #1 and #9): a one-sentence
 * read on where the recent readings are heading, plus the digest numbers —
 * the highest and lowest readings in the range and, on multi-day ranges, how
 * many consecutive days stayed entirely in the normal band.
 *
 * Everything is derived from the readings the dashboard already fetched (see
 * ./trendInsight.ts) — no extra request. Renders nothing when there is no
 * data to summarise, so the caller can drop it in unconditionally.
 */
export function TrendInsightCard({ data, unit, rangeHours, className }: TrendInsightCardProps) {
  const insight = useMemo(() => {
    const readings: InsightReading[] = [];
    for (const measurement of data) {
      if (measurement.valueNum == null) continue;
      readings.push({ ts: new Date(measurement.ts).getTime(), celsius: measurement.valueNum });
    }
    return computeTrendInsight(readings, rangeHours);
    // `data` is a fresh array on every 5 s refetch, which is exactly when this
    // should recompute; rangeHours changes the window it is computed over.
  }, [data, rangeHours]);

  if (insight.readingCount === 0) return null;

  const DirectionIcon = insight.comparison ? DIRECTION_ICON[insight.comparison.direction] : Sparkles;

  return (
    <Card
      density="compact"
      className={className}
      header={
        <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink-primary">
          <Sparkles className="size-4" aria-hidden />
          Your trend
        </h2>
      }
    >
      <div className="flex items-start gap-3">
        <DirectionIcon className="mt-0.5 size-5 shrink-0 text-ink-secondary" aria-hidden />
        <div className="min-w-0">
          <p className="text-body text-ink-primary">
            {insight.comparison
              ? comparisonSentence(insight.comparison, unit)
              : 'Not enough readings yet to compare this period with the one before it.'}
          </p>
          {insight.comparison && (
            <p className="mt-0.5 font-tabular text-caption text-ink-muted">
              {formatReading(insight.comparison.recentAvgCelsius, unit)} now · was{' '}
              {formatReading(insight.comparison.priorAvgCelsius, unit)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border-hairline pt-4 dark:border-border-hairline/[0.08] sm:grid-cols-3">
        {insight.highest && (
          <Stat
            label="Highest"
            value={formatReading(insight.highest.celsius, unit)}
            detail={relativeTime(insight.highest.ts)}
          />
        )}
        {insight.lowest && (
          <Stat
            label="Lowest"
            value={formatReading(insight.lowest.celsius, unit)}
            detail={relativeTime(insight.lowest.ts)}
          />
        )}
        {insight.normalDayStreak != null ? (
          <Stat
            label="Normal streak"
            value={insight.normalDayStreak === 1 ? '1 day' : `${insight.normalDayStreak} days`}
            detail="in a row, all normal"
          />
        ) : (
          <Stat label="Readings" value={String(insight.readingCount)} detail="in this range" />
        )}
      </div>
    </Card>
  );
}
