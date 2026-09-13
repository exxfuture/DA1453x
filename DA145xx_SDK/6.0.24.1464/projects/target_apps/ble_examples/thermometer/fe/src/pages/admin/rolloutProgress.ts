import type { RolloutSummaryResponse } from '../../api/client';
import type { BadgeStatus } from '../../components/ui/Badge';
import type { ProgressVariant } from '../../components/ui/ProgressBar';

/** The statuses `rollout_targets` uses, in the order the UI reports them. */
export const TARGET_STATUSES = ['installed', 'failed', 'pending'] as const;

export interface RolloutProgress {
  installed: number;
  failed: number;
  pending: number;
  /** Targets that have reported anything at all — installed + failed. */
  reported: number;
  /** Failures as a percentage of the whole target set, for the abort threshold. */
  failedPct: number;
}

/**
 * Reads the per-status tallies off a rollout summary.
 *
 * `statusCounts` is **sparse**: the backend only includes statuses that
 * actually occur, so a rollout nobody has reported on yet arrives as `{}`
 * rather than three zeroes. Every read here goes through a `?? 0`, and no
 * caller should index the map directly.
 */
export function rolloutProgress(rollout: RolloutSummaryResponse): RolloutProgress {
  const counts = rollout.statusCounts ?? {};
  const installed = counts.installed ?? 0;
  const failed = counts.failed ?? 0;
  const pending = counts.pending ?? 0;

  return {
    installed,
    failed,
    pending,
    reported: installed + failed,
    failedPct: rollout.targetCount > 0 ? (failed / rollout.targetCount) * 100 : 0,
  };
}

/**
 * How the completion bar should read: past the rollout's own abort threshold
 * it is a failure signal, fully installed is a success, anything else is
 * simply progress.
 */
export function progressVariant(rollout: RolloutSummaryResponse): ProgressVariant {
  const progress = rolloutProgress(rollout);
  if (progress.failedPct > rollout.abortThresholdPct) return 'danger';
  if (rollout.targetCount > 0 && progress.installed === rollout.targetCount) return 'success';
  return 'default';
}

/**
 * Rollout and target statuses are free-form strings server-side, so anything
 * unrecognised falls back to neutral rather than being asserted into a status
 * color it may not deserve.
 */
export function rolloutStatusBadge(status: string): BadgeStatus {
  switch (status) {
    case 'completed':
      return 'success';
    case 'active':
      return 'info';
    case 'aborted':
    case 'failed':
      return 'danger';
    case 'paused':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function targetStatusBadge(status: string): BadgeStatus {
  switch (status) {
    case 'installed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
      return 'neutral';
    default:
      return 'neutral';
  }
}
