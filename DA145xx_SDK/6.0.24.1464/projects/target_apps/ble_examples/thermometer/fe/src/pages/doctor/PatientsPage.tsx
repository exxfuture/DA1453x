import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, GitCompare, Users } from 'lucide-react';
import { PatientResponse, TemperatureUnit, ThresholdSource } from '../../api/client';
import {
  useCareNotes,
  useClearPatientThreshold,
  useCreateCareNote,
  useDeleteCareNote,
  useDoctorPatients,
  useMe,
  useMeasurementHistory,
  usePatientThreshold,
  useResolvedThresholds,
  useUpsertPatientThreshold,
} from '../../api/queries';
import { useMeasurementHistories } from '../../api/useMeasurementHistories';
import { MeasurementChart } from '../../components/MeasurementChart';
import { NoteThread } from '../../components/NoteThread';
import { TemperatureChart, TemperatureSeries } from '../../components/TemperatureChart';
import { ThresholdEditor, ThresholdValues } from '../../components/ThresholdEditor';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { cn } from '../../components/ui/cn';
import { EmptyState, SkeletonBlock } from '../../components/ui/EmptyState';
import { MAX_OVERLAY_SERIES, useChartColors } from '../../theme/chartColors';
import { convertFromCelsius } from '../../utils/temperature';
import type { TimeWindow } from '../../utils/timeWindow';

/** Window every chart on this page reads, in hours. No custom-range UI here
 *  (doctor fleet view) — see DashboardPage/HistoryPage for that. */
const RANGE_HOURS = 24;
const RANGE_WINDOW: TimeWindow = { kind: 'sliding', hours: RANGE_HOURS };

/** Height of the chart skeleton: 280 plot + 48 brush strip + 40 step-button row. */
const CHART_SKELETON = 'h-[368px]';

function displayName(patient: PatientResponse): string {
  return patient.patientUsername ?? patient.patientUserId;
}

export function PatientsPage() {
  const patientsQuery = useDoctorPatients();
  const meQuery = useMe();
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';
  // Deep-linked from the doctor Dashboard's "View" action (?patient=<id>) —
  // falls back to unselected if the id doesn't match a current patient.
  const [searchParams] = useSearchParams();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(searchParams.get('patient'));
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // Memoised so it is the same array identity between renders: several
  // useMemo/useEffect hooks below depend on it, and `?? []` would hand them a
  // fresh empty array on every render (react-hooks/exhaustive-deps, review FE-08).
  const patients = useMemo(() => patientsQuery.data ?? [], [patientsQuery.data]);
  const selected = patients.find((p) => p.patientUserId === selectedPatientId) ?? null;

  const comparePatients = useMemo(
    () => patients.filter((p) => compareIds.includes(p.patientUserId) && p.deviceBdAddr != null),
    [patients, compareIds],
  );

  function toggleCompare(patientUserId: string) {
    setCompareIds((previous) =>
      previous.includes(patientUserId)
        ? previous.filter((id) => id !== patientUserId)
        : previous.length >= MAX_OVERLAY_SERIES
          ? previous
          : [...previous, patientUserId],
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-display font-semibold text-ink-primary">Patients</h1>
        {patients.length > 1 && (
          <Button
            size="sm"
            variant={compareMode ? 'primary' : 'tertiary'}
            onClick={() => setCompareMode((v) => !v)}
            aria-pressed={compareMode}
          >
            <GitCompare className="size-4" aria-hidden />
            Compare
          </Button>
        )}
      </div>

      {patientsQuery.isLoading && <SkeletonBlock className="h-40" />}
      {patients.length === 0 && !patientsQuery.isLoading && (
        <Card density="compact">
          <EmptyState icon={Users} title="No patients have granted you access yet." />
        </Card>
      )}

      {patients.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_2fr]">
          <ul className="space-y-1">
            {patients.map((patient) => {
              const checked = compareIds.includes(patient.patientUserId);
              const disabled = compareMode && !checked && compareIds.length >= MAX_OVERLAY_SERIES;
              const isSelected = !compareMode && selectedPatientId === patient.patientUserId;
              // A claimed device can have a null model: nothing forces a
              // collector to report one (see ConnectPage, review FE-14).
              const subtitle = patient.deviceBdAddr
                ? `${patient.deviceModel ?? 'unknown model'} (${patient.deviceBdAddr})`
                : 'no device claimed';

              if (compareMode) {
                return (
                  <li key={patient.patientUserId}>
                    <label
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md border-l-[3px] p-3 text-left transition-colors duration-fast ease-standard',
                        checked ? 'border-l-primary-600 bg-primary-50 dark:bg-primary-950' : 'border-l-transparent',
                        patient.deviceBdAddr == null || disabled
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer hover:bg-sand-50 dark:hover:bg-surface-2',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary-600"
                        checked={checked}
                        disabled={patient.deviceBdAddr == null || disabled}
                        onChange={() => toggleCompare(patient.patientUserId)}
                      />
                      <span className="min-w-0">
                        <span className="block text-body font-semibold text-ink-primary">{displayName(patient)}</span>
                        <span className="block text-caption text-ink-muted">{subtitle}</span>
                      </span>
                    </label>
                  </li>
                );
              }

              return (
                <li key={patient.patientUserId}>
                  <button
                    onClick={() => setSelectedPatientId(patient.patientUserId)}
                    className={cn(
                      'w-full rounded-md border-l-[3px] p-3 text-left transition-colors duration-fast ease-standard',
                      'focus-visible:outline-none focus-visible:shadow-focus',
                      isSelected
                        ? 'border-l-primary-600 bg-primary-50 dark:bg-primary-950'
                        : 'border-l-transparent hover:bg-sand-50 dark:hover:bg-surface-2',
                    )}
                  >
                    <div className="text-body font-semibold text-ink-primary">{displayName(patient)}</div>
                    <div className="text-caption text-ink-muted">{subtitle}</div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="space-y-4">
            {compareMode ? (
              <CompareView patients={comparePatients} unit={unit} />
            ) : (
              <>
                {!selected && (
                  <Card density="compact">
                    <p className="text-body text-ink-muted">Select a patient to view their readings.</p>
                  </Card>
                )}
                {selected && <PatientDetail patient={selected} unit={unit} />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Chart + clinical tools for one patient: threshold override and care notes. */
function PatientDetail({ patient, unit }: { patient: PatientResponse; unit: TemperatureUnit }) {
  const historyQuery = useMeasurementHistory(patient.deviceBdAddr, RANGE_WINDOW);

  return (
    <>
      {patient.deviceBdAddr ? (
        <Card
          density="compact"
          header={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h3 font-semibold text-ink-primary">{displayName(patient)} — last 24h</h2>
              <Link
                to={`/patients/${encodeURIComponent(patient.patientUserId)}/report`}
                className="inline-flex items-center gap-1.5 text-body font-semibold text-primary-600 hover:underline dark:text-primary-300"
              >
                <FileText className="size-4" aria-hidden />
                Clinical report
              </Link>
            </div>
          }
        >
          {historyQuery.isLoading ? (
            <SkeletonBlock className={CHART_SKELETON} />
          ) : (
            // Keyed by the charted device: PatientDetail is reused across
            // patients, so without this the zoom window would follow the doctor
            // from one patient onto the next (see TemperatureChart).
            <MeasurementChart key={patient.deviceBdAddr} data={historyQuery.data ?? []} unit={unit} />
          )}
        </Card>
      ) : (
        <Card density="compact">
          <p className="text-body text-ink-muted">This patient hasn't claimed a device yet.</p>
        </Card>
      )}

      <PatientThresholdCard patientUserId={patient.patientUserId} />
      <CareNotesCard patientUserId={patient.patientUserId} patientName={displayName(patient)} />
    </>
  );
}

/**
 * The `source` values the API returns are snake_case scope names; the editor
 * speaks the design-system scope vocabulary. Mapping `doctor_override` onto
 * the editor's own scope is what makes it stop showing "currently inherits
 * from …" once this doctor has saved an override.
 */
const THRESHOLD_SOURCE_LABEL: Record<ThresholdSource, string> = {
  doctor_override: 'doctor-override',
  self: "the patient's own thresholds",
  system: 'the system defaults',
  fallback: 'the built-in defaults',
};

function PatientThresholdCard({ patientUserId }: { patientUserId: string }) {
  const overrideQuery = usePatientThreshold(patientUserId);
  const resolvedQuery = useResolvedThresholds(patientUserId);
  const upsert = useUpsertPatientThreshold();
  const clear = useClearPatientThreshold();

  const override = overrideQuery.data ?? null;
  const resolved = resolvedQuery.data ?? null;

  if (overrideQuery.isLoading || resolvedQuery.isLoading) {
    return <SkeletonBlock className="h-56" />;
  }
  if (!resolved) return null;

  // Seed the form with the override when there is one, otherwise with whatever
  // is currently in effect — so saving never silently changes a boundary the
  // doctor didn't look at.
  const source = override ?? resolved;
  const value: ThresholdValues = {
    normalStartC: source.normalStartC,
    elevatedStartC: source.elevatedStartC,
    feverStartC: source.feverStartC,
    highFeverStartC: source.highFeverStartC,
  };
  const mutationError = upsert.error ?? clear.error;

  return (
    <Card density="compact">
      <ThresholdEditor
        scope="doctor-override"
        value={value}
        resolvedSource={THRESHOLD_SOURCE_LABEL[resolved.source]}
        saving={upsert.isPending}
        onSave={(values) => upsert.mutate({ patientUserId, values })}
      />
      {override && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-hairline pt-3 dark:border-border-hairline/[0.08]">
          <p className="text-caption text-ink-muted">
            Your override applies to what you see for this patient — it does not change their own thresholds.
          </p>
          <Button
            size="sm"
            variant="tertiary"
            loading={clear.isPending}
            onClick={() => clear.mutate(patientUserId)}
          >
            Remove override
          </Button>
        </div>
      )}
      {mutationError && (
        <Alert status="danger" className="mt-3">
          {mutationError.message}
        </Alert>
      )}
    </Card>
  );
}

function CareNotesCard({ patientUserId, patientName }: { patientUserId: string; patientName: string }) {
  const notesQuery = useCareNotes(patientUserId);
  const create = useCreateCareNote();
  const remove = useDeleteCareNote();

  const notes = useMemo(
    () =>
      (notesQuery.data ?? []).map((note) => ({
        id: note.id,
        author: note.doctorUsername ?? undefined,
        note: note.note,
        createdAt: new Date(note.createdAt).getTime(),
      })),
    [notesQuery.data],
  );

  const mutationError = create.error ?? remove.error;

  return (
    <Card
      density="compact"
      header={
        <div>
          <h2 className="text-h3 font-semibold text-ink-primary">Care notes</h2>
          <p className="text-caption text-ink-muted">
            Private to you — {patientName} cannot read these. Administrators can, for compliance.
          </p>
        </div>
      }
    >
      {notesQuery.isLoading ? (
        <SkeletonBlock className="h-32" />
      ) : (
        <NoteThread
          notes={notes}
          adding={create.isPending}
          placeholder={`Clinical note about ${patientName}…`}
          emptyText="No notes about this patient yet."
          onAdd={(note) => create.mutate({ patientUserId, note })}
          onDelete={(id) => remove.mutate(id)}
        />
      )}
      {mutationError && (
        <Alert status="danger" className="mt-3">
          {mutationError.message}
        </Alert>
      )}
    </Card>
  );
}

/**
 * Multi-patient overlay. Each patient's history is fetched under the same key
 * `useMeasurementHistory` uses, so switching between compare and single view
 * hits the cache instead of refetching.
 */
function CompareView({ patients, unit }: { patients: PatientResponse[]; unit: TemperatureUnit }) {
  const colors = useChartColors();

  // The shared parallel-history hook (review FE-21) — this used to re-implement
  // it with its own useQueries call, a second copy of the
  // ['measurements', bdAddr, timeWindowKey(window)] key that the customer
  // dashboard's overlay and the single-patient chart above also use. Two copies
  // of cache-key-sensitive fetch logic drift the moment one changes its interval
  // or key shape; one hook cannot.
  const histories = useMeasurementHistories(
    patients.map((patient) => patient.deviceBdAddr).filter((bdAddr): bdAddr is string => bdAddr != null),
    RANGE_WINDOW,
  );

  const isLoading = histories.isLoading;

  const series = useMemo<TemperatureSeries[]>(
    () =>
      patients.map((patient, index) => ({
        id: patient.patientUserId,
        label: displayName(patient),
        color: colors.seriesPalette[index % colors.seriesPalette.length],
        points: [...(histories.byBdAddr[patient.deviceBdAddr ?? ''] ?? [])]
          // Backend returns newest-first; the chart reads oldest-first.
          .reverse()
          .filter((m) => m.valueNum !== null)
          .map((m) => {
            const celsius = m.valueNum as number;
            return { ts: new Date(m.ts).getTime(), celsius, value: convertFromCelsius(celsius, unit) };
          }),
      })),
    [patients, histories.byBdAddr, unit, colors.seriesPalette],
  );

  if (patients.length === 0) {
    return (
      <Card density="compact">
        <EmptyState
          icon={GitCompare}
          title="Pick patients to compare"
          description={`Select up to ${MAX_OVERLAY_SERIES} patients with a claimed device to overlay their last ${RANGE_HOURS}h.`}
        />
      </Card>
    );
  }

  return (
    <Card
      density="compact"
      header={
        <h2 className="text-h3 font-semibold text-ink-primary">
          Comparing {patients.length} patient{patients.length === 1 ? '' : 's'} — last {RANGE_HOURS}h
        </h2>
      }
    >
      {isLoading ? (
        <SkeletonBlock className={CHART_SKELETON} />
      ) : (
        // Keyed by the compared set: an absolute time window carries no meaning
        // once a different set of patients is being charted.
        <TemperatureChart key={patients.map((p) => p.patientUserId).join('|')} series={series} unit={unit} />
      )}
    </Card>
  );
}
