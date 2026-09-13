import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { RiskTier } from '../api/client';
import { Badge, type BadgeStatus } from './ui/Badge';
import { cn } from './ui/cn';

/**
 * Triage presentation shared by the doctor fleet table, the patient detail
 * pane and the printable report.
 *
 * The risk tier/score come from the backend summary — nothing here recomputes
 * them. They are an *ordering heuristic* for a worklist, not a clinical
 * assessment, which is why the badge always carries the word "risk" nearby in
 * the calling UI.
 */

const RISK_BADGE: Record<RiskTier, { status: BadgeStatus; label: string }> = {
  urgent: { status: 'danger', label: 'Urgent' },
  watch: { status: 'warning', label: 'Watch' },
  low: { status: 'success', label: 'Low' },
};

/** Highest-risk-first ordering for the fleet table's "risk" sort. */
export const RISK_RANK: Record<RiskTier, number> = { urgent: 0, watch: 1, low: 2 };

export function RiskBadge({ tier, score, className }: { tier: RiskTier; score?: number; className?: string }) {
  const { status, label } = RISK_BADGE[tier];
  return (
    <Badge status={status} className={className}>
      {label}
      {score != null && <span className="font-tabular font-normal">{Math.round(score)}</span>}
    </Badge>
  );
}

export type Trend = 'rising' | 'falling' | 'flat';

/** Below this, latest-vs-average is sensor noise rather than a direction. */
const TREND_DELTA_CELSIUS = 0.15;

/**
 * Direction of the latest reading against the average over the selected
 * period. Deliberately a plain comparison — the backend already ships the
 * period aggregates, so no extra request is needed for a directional hint.
 */
export function computeTrend(latestCelsius: number | null, avgCelsius: number | null): Trend | null {
  if (latestCelsius == null || avgCelsius == null) return null;
  const delta = latestCelsius - avgCelsius;
  if (Math.abs(delta) < TREND_DELTA_CELSIUS) return 'flat';
  return delta > 0 ? 'rising' : 'falling';
}

const TREND_ICON: Record<Trend, typeof TrendingUp> = {
  rising: TrendingUp,
  falling: TrendingDown,
  flat: Minus,
};

const TREND_LABEL: Record<Trend, string> = {
  rising: 'Rising vs period average',
  falling: 'Falling vs period average',
  flat: 'Steady vs period average',
};

/** Warm = rising toward fever, cool = falling; steady stays muted. */
const TREND_CLASS: Record<Trend, string> = {
  rising: 'text-danger-text',
  falling: 'text-info-text',
  flat: 'text-ink-muted',
};

export function TrendArrow({ trend, className }: { trend: Trend; className?: string }) {
  const Icon = TREND_ICON[trend];
  return (
    <Icon
      role="img"
      aria-label={TREND_LABEL[trend]}
      className={cn('inline-block size-4 shrink-0 align-text-bottom', TREND_CLASS[trend], className)}
    />
  );
}
