import { FormEvent, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, KeyRound, ShieldCheck, ShieldOff, Stethoscope } from 'lucide-react';
import {
  useClearMyThreshold,
  useConsentAccessHistory,
  useConsents,
  useDoctors,
  useGrantConsent,
  useMe,
  useMyThreshold,
  useResolvedThresholds,
  useRevokeConsent,
  useSystemThreshold,
  useUpdateMe,
  useUpsertMyThreshold,
  useUpsertSystemThreshold,
} from '../api/queries';
import { TemperatureUnit, ThresholdSource } from '../api/client';
import { redirectToChangePassword } from '../auth/oidc';
import { ThresholdEditor, type ThresholdValues } from '../components/ThresholdEditor';
import { TEMPERATURE_TIER_BANDS } from '../theme/temperature';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { Timeline, type TimelineItem } from '../components/ui/Timeline';

export function SettingsPage() {
  const meQuery = useMe();
  const updateMe = useUpdateMe();
  const [displayName, setDisplayName] = useState('');
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>('CELSIUS');

  useEffect(() => {
    if (meQuery.data) {
      setDisplayName(meQuery.data.displayName ?? '');
      setTemperatureUnit(meQuery.data.temperatureUnit);
    }
  }, [meQuery.data]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateMe.mutate({ displayName, temperatureUnit });
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <h1 className="font-display text-display font-semibold text-ink-primary">Settings</h1>

      <Card density="compact" header={<h2 className="text-h3 font-semibold text-ink-primary">Profile</h2>}>
        {meQuery.data && (
          <div className="space-y-3">
            <div className="text-body text-ink-secondary">
              Username: <span className="text-ink-primary">{meQuery.data.username}</span>
            </div>
            <div className="text-body text-ink-secondary">
              Email: <span className="text-ink-primary">{meQuery.data.email ?? '—'}</span>
            </div>
            <div className="text-body text-ink-secondary">
              Role: <span className="text-ink-primary capitalize">{meQuery.data.role}</span>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                id="displayName"
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <div className="space-y-1.5">
                <label className="block text-label uppercase tracking-wide text-ink-secondary" htmlFor="temperatureUnit">
                  Temperature unit
                </label>
                <select
                  id="temperatureUnit"
                  className="h-touch w-full rounded-md border border-sand-500 bg-surface-1 px-3 text-body text-ink-primary dark:border-sand-600 focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus"
                  value={temperatureUnit}
                  onChange={(e) => setTemperatureUnit(e.target.value as TemperatureUnit)}
                >
                  <option value="CELSIUS">Celsius (°C)</option>
                  <option value="FAHRENHEIT">Fahrenheit (°F)</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" loading={updateMe.isPending}>
                  Save
                </Button>
                {updateMe.isSuccess && <span className="text-body font-semibold text-success-text">Saved ✓</span>}
              </div>
              {updateMe.isError && <Alert status="danger">Could not save settings — please try again.</Alert>}
            </form>
          </div>
        )}
      </Card>

      <ChangePassword />

      {meQuery.data?.role === 'customer' && (
        <>
          <MyThresholds />
          <MyDoctors />
        </>
      )}

      {meQuery.data?.role === 'admin' && <SystemThresholds />}
    </div>
  );
}

function ChangePassword() {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setRedirecting(true);
    setError(null);
    try {
      // Sends the browser into Keycloak's own "update password" form (same
      // required-action its Account Console uses) — Keycloak verifies
      // identity via the existing session and enforces the realm's password
      // policy; it redirects back here on completion or cancellation. No
      // password is ever handled by this app's own code.
      await redirectToChangePassword();
    } catch (err) {
      setRedirecting(false);
      setError(err instanceof Error ? err.message : 'Could not start the password change flow.');
    }
  };

  return (
    <Card
      density="compact"
      header={
        <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink-primary">
          <KeyRound className="size-4" aria-hidden />
          Password
        </h2>
      }
    >
      <p className="mb-3 text-caption text-ink-muted">
        Changing your password takes you to Keycloak's own secure form, then brings you back here.
      </p>
      <Button type="button" size="sm" loading={redirecting} onClick={() => void handleClick()}>
        Change password
      </Button>
      {error && (
        <Alert status="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}

/**
 * How to name each non-personal source in the editor's "currently inherits
 * from X" line. `self` is handled separately (it maps to the editor's own
 * scope, so no note is shown), and `doctor_override` never reaches here —
 * see MyThresholds() for why.
 */
const THRESHOLD_SOURCE_LABEL: Partial<Record<ThresholdSource, string>> = {
  system: 'the system default',
  fallback: 'the built-in default',
};

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
 * Personal alert thresholds (customer feature #5).
 *
 * Three states worth keeping straight:
 * - `useMyThreshold()` is `undefined` while loading and `null` when nothing is
 *   stored (the customer inherits) — the two must not be conflated.
 * - A doctor's override outranks a personal scale, so when one is in effect
 *   the editor's stock "saving here overrides it" note would be wrong; it is
 *   replaced by an explicit explanation instead.
 */
function MyThresholds() {
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
          doctorOverridden || resolved.source === 'self'
            ? undefined
            : THRESHOLD_SOURCE_LABEL[resolved.source]
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

/**
 * The system-wide default scale (admin feature #8).
 *
 * Lives here rather than in the admin console because it is a single form —
 * a tab of its own would be a near-empty page — and because it is edited the
 * same way a customer edits their own scale.
 *
 * `useSystemThreshold()` is `undefined` while loading and `null` when no
 * system row has ever been stored, in which case the built-in fallback (the
 * tier scale in theme/temperature.ts, which the backend mirrors) is what is
 * actually in effect; the form seeds from it so saving starts from the real
 * boundaries rather than from zeroes.
 */
function SystemThresholds() {
  const systemQuery = useSystemThreshold();
  const upsertThreshold = useUpsertSystemThreshold();

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

      {upsertThreshold.isSuccess && (
        <p className="mt-3 text-body font-semibold text-success-text">System defaults saved ✓</p>
      )}
      {upsertThreshold.isError && (
        <Alert status="danger" className="mt-3">
          Could not save the system defaults — please try again.
        </Alert>
      )}
    </Card>
  );
}

/**
 * Doctor-access transparency (customer feature #8).
 *
 * Strictly the consent *lifecycle*: the audit log records grants and
 * revocations, never reads, so this must never be presented as "who looked at
 * my data". The heading and the note below say so explicitly.
 */
function ConsentHistory() {
  // Pagination is 1-based, the API's PageResponse is 0-based.
  const [page, setPage] = useState(1);
  const historyQuery = useConsentAccessHistory({ page: page - 1, size: 10 });

  const items: TimelineItem[] = (historyQuery.data?.content ?? []).map((entry) => {
    const granted = entry.action === 'consent.grant';
    const doctor = entry.doctorUsername ?? entry.doctorUserId ?? 'a doctor';
    return {
      id: String(entry.id),
      icon: granted ? ShieldCheck : ShieldOff,
      label: granted ? `You granted access to ${doctor}` : `You revoked access from ${doctor}`,
      timestamp: new Date(entry.at).getTime(),
    };
  });

  if (historyQuery.isLoading) return <SkeletonBlock className="h-24" />;

  if (historyQuery.isError) {
    return <Alert status="danger">Could not load your access history — please try again.</Alert>;
  }

  return (
    <div className="space-y-3">
      <p className="text-caption text-ink-muted">
        A record of every time you granted or revoked a doctor's access. It does not show when a doctor
        actually opened your readings — that is not tracked.
      </p>
      <Timeline items={items} emptyText="You haven't granted or revoked access yet." />
      <Pagination page={page} totalPages={historyQuery.data?.totalPages ?? 1} onPageChange={setPage} />
    </div>
  );
}

function MyDoctors() {
  const doctorsQuery = useDoctors();
  const consentsQuery = useConsents();
  const grantConsent = useGrantConsent();
  const revokeConsent = useRevokeConsent();
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const activeConsents = consentsQuery.data?.filter((c) => c.revokedAt === null) ?? [];
  const grantedDoctorIds = new Set(activeConsents.map((c) => c.doctorUserId));
  const grantableDoctors = doctorsQuery.data?.filter((d) => !grantedDoctorIds.has(d.id)) ?? [];

  const handleGrant = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDoctorId) return;
    grantConsent.mutate(selectedDoctorId, { onSuccess: () => setSelectedDoctorId('') });
  };

  return (
    <Card density="compact" header={<h2 className="text-h3 font-semibold text-ink-primary">My doctors</h2>}>
      <p className="mb-3 text-caption text-ink-muted">Doctors you grant access to can see your device's readings.</p>

      {activeConsents.length === 0 ? (
        <EmptyState icon={Stethoscope} title="No doctors have access yet" />
      ) : (
        <ul className="space-y-2">
          {activeConsents.map((consent) => (
            <li key={consent.id} className="flex items-center justify-between text-body">
              <span className="text-ink-primary">{consent.doctorUsername ?? consent.doctorUserId}</span>
              <Button variant="tertiary" size="sm" onClick={() => revokeConsent.mutate(consent.id)} loading={revokeConsent.isPending}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {grantableDoctors.length > 0 && (
        <form onSubmit={handleGrant} className="mt-3 flex items-end gap-2 border-t border-border-hairline pt-3 dark:border-border-hairline/[0.08]">
          <div className="flex-1 space-y-1.5">
            <label className="block text-label uppercase tracking-wide text-ink-secondary" htmlFor="grant-doctor">
              Grant access to
            </label>
            <select
              id="grant-doctor"
              className="h-touch w-full rounded-md border border-sand-500 bg-surface-1 px-3 text-body text-ink-primary dark:border-sand-600 focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus"
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
            >
              <option value="">Select a doctor…</option>
              {grantableDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.displayName ?? doctor.username}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={!selectedDoctorId} loading={grantConsent.isPending}>
            Grant
          </Button>
        </form>
      )}

      <div className="mt-3 border-t border-border-hairline pt-3 dark:border-border-hairline/[0.08]">
        <Button
          type="button"
          size="sm"
          variant="tertiary"
          onClick={() => setHistoryOpen((open) => !open)}
          aria-expanded={historyOpen}
          aria-controls="consent-history"
        >
          {historyOpen ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
          Access history
        </Button>
        {/* Mounted only when opened, so the extra request is paid for on demand. */}
        {historyOpen && (
          <div id="consent-history" className="mt-3">
            <ConsentHistory />
          </div>
        )}
      </div>
    </Card>
  );
}
