import { useSystemThreshold, useUpsertSystemThreshold } from '../../api/queries';
import { useTransientFlag } from '../../hooks/useTransientFlag';
import { ThresholdEditor, type ThresholdValues } from '../../components/ThresholdEditor';
import { TEMPERATURE_TIER_BANDS } from '../../theme/temperature';
import { Alert } from '../../components/ui/Alert';
import { Card } from '../../components/ui/Card';
import { SkeletonBlock } from '../../components/ui/EmptyState';

/**
 * The scale that applies when nothing is stored at any scope, derived from
 * the shared tier bands rather than re-typed — the backend's own fallback
 * mirrors the same cut points, so a divergence here would be a silent
 * disagreement about what "fever" means.
 */
const BUILT_IN_THRESHOLDS: ThresholdValues = {
  normalStartC: TEMPERATURE_TIER_BANDS[0].max,
  elevatedStartC: TEMPERATURE_TIER_BANDS[1].max,
  feverStartC: TEMPERATURE_TIER_BANDS[2].max,
  highFeverStartC: TEMPERATURE_TIER_BANDS[3].max,
};

/**
 * The system-wide default scale (admin feature #8).
 *
 * Lives on the Settings page rather than in the admin console because it is a
 * single form — a tab of its own would be a near-empty page — and because it is
 * edited the same way a customer edits their own scale.
 *
 * `useSystemThreshold()` is `undefined` while loading and `null` when no
 * system row has ever been stored, in which case the built-in fallback (the
 * tier scale in theme/temperature.ts, which the backend mirrors) is what is
 * actually in effect; the form seeds from it so saving starts from the real
 * boundaries rather than from zeroes.
 */
export function SystemThresholdsSection() {
  const systemQuery = useSystemThreshold();
  const upsertThreshold = useUpsertSystemThreshold();
  const justSaved = useTransientFlag(upsertThreshold.isSuccess);

  const header = <h2 className="text-h3 font-semibold text-ink-primary">System default thresholds</h2>;

  if (systemQuery.isLoading) {
    return (
      <Card density="compact" header={header}>
        <SkeletonBlock className="h-48" />
      </Card>
    );
  }

  const stored = systemQuery.data;
  const value: ThresholdValues = stored ?? BUILT_IN_THRESHOLDS;

  return (
    <Card density="compact" header={header}>
      <p className="mb-3 text-caption text-ink-muted">
        The scale everyone falls back to. It applies to every user who has not set their own, and to every doctor
        override that leaves a boundary untouched. Changing it re-tiers existing readings everywhere they are
        displayed — badges, chart bands and fever episodes — because tiers are derived on read, not stored.
      </p>

      {!stored && (
        <Alert status="info" className="mb-3">
          No system scale has been stored yet, so the built-in default is in effect. The values below are that
          default.
        </Alert>
      )}

      <ThresholdEditor
        scope="system"
        value={value}
        resolvedSource={stored ? undefined : 'the built-in default'}
        onSave={(values) => upsertThreshold.mutate(values)}
        saving={upsertThreshold.isPending}
      />

      {/* Expires on its own — see useTransientFlag (review FE-29). */}
      {justSaved && <p className="mt-3 text-body font-semibold text-success-text">System defaults saved ✓</p>}
      {upsertThreshold.isError && (
        <Alert status="danger" className="mt-3">
          Could not save the system defaults — please try again.
        </Alert>
      )}
    </Card>
  );
}
