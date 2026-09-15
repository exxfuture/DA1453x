import { ThresholdSource } from '../../api/client';
import { useClearMyThreshold, useMyThreshold, useResolvedThresholds, useUpsertMyThreshold } from '../../api/queries';
import { ThresholdEditor, type ThresholdValues } from '../../components/ThresholdEditor';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SkeletonBlock } from '../../components/ui/EmptyState';

/**
 * How to name each non-personal source in the editor's "currently inherits
 * from X" line. `self` is handled separately (it maps to the editor's own
 * scope, so no note is shown), and `doctor_override` never reaches here —
 * see below for why.
 */
const THRESHOLD_SOURCE_LABEL: Partial<Record<ThresholdSource, string>> = {
  system: 'the system default',
  fallback: 'the built-in default',
};

/**
 * Personal alert thresholds (customer feature #5).
 *
 * Three states worth keeping straight:
 * - `useMyThreshold()` is `undefined` while loading and `null` when nothing is
 *   stored (the customer inherits) — the two must not be conflated.
 * - A doctor's override outranks a personal scale, so when one is in effect
 *   the editor's stock "saving here overrides it" note would be wrong; it is
 *   replaced by an explicit explanation instead.
 */
export function MyThresholdsSection() {
  const mineQuery = useMyThreshold();
  const resolvedQuery = useResolvedThresholds();
  const upsertThreshold = useUpsertMyThreshold();
  const clearThreshold = useClearMyThreshold();

  const mine = mineQuery.data;
  const resolved = resolvedQuery.data;

  const header = <h2 className="text-h3 font-semibold text-ink-primary">Alert thresholds</h2>;

  if (mineQuery.isLoading || resolvedQuery.isLoading || !resolved) {
    return (
      <Card density="compact" header={header}>
        <SkeletonBlock className="h-48" />
      </Card>
    );
  }

  const doctorOverridden = resolved.source === 'doctor_override';
  const value: ThresholdValues = mine ?? {
    normalStartC: resolved.normalStartC,
    elevatedStartC: resolved.elevatedStartC,
    feverStartC: resolved.feverStartC,
    highFeverStartC: resolved.highFeverStartC,
  };

  return (
    <Card density="compact" header={header}>
      <p className="mb-3 text-caption text-ink-muted">
        These cut points decide which readings count as elevated or feverish — for the badges on your
        dashboard and the episodes in your fever history. They are not medical advice.
      </p>

      {doctorOverridden && (
        <Alert status="info" className="mb-3">
          A doctor you granted access to has set a scale for you, and it takes precedence over your own.
          Anything you save here applies again once that override is removed.
        </Alert>
      )}

      <p className="mb-4 font-tabular text-caption text-ink-secondary">
        In effect now: Normal starts at {resolved.normalStartC} °C · Elevated starts at {resolved.elevatedStartC} °C
        {' '}· Fever starts at {resolved.feverStartC} °C · High Fever starts at {resolved.highFeverStartC} °C
      </p>

      <ThresholdEditor
        scope="customer"
        value={value}
        resolvedSource={
          doctorOverridden || resolved.source === 'self' ? undefined : THRESHOLD_SOURCE_LABEL[resolved.source]
        }
        onSave={(values) => upsertThreshold.mutate(values)}
        saving={upsertThreshold.isPending}
      />

      {mine && (
        <div className="mt-3 flex items-center gap-3 border-t border-border-hairline pt-3 dark:border-border-hairline/[0.08]">
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => clearThreshold.mutate()}
            loading={clearThreshold.isPending}
          >
            Use the default scale instead
          </Button>
          <span className="text-caption text-ink-muted">Removes your personal thresholds.</span>
        </div>
      )}

      {(upsertThreshold.isError || clearThreshold.isError) && (
        <Alert status="danger" className="mt-3">
          Could not save your thresholds — please try again.
        </Alert>
      )}
    </Card>
  );
}
