import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, Users } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from 'recharts';
import { TemperatureUnit } from '../api/client';
import {
  useCareNotes,
  useDoctorPatients,
  useDoctorPatientsSummary,
  useMe,
  useMeasurementHistory,
  useResolvedThresholds,
} from '../api/queries';
import { computeYDomain, TemperatureSeriesPoint } from '../components/temperatureWindow';
import { RiskBadge } from '../components/PatientTriage';
import { TemperatureBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableHeadRow, TableRow } from '../components/ui/Table';
import { LIGHT_CHART_COLORS } from '../theme/chartColors';
import { getTemperatureTier, TEMPERATURE_TIER_BANDS } from '../theme/temperature';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import { bucketMsFor, bucketReadings } from '../utils/doctorFeeds';
import { formatTemperature, formatTemperatureDelta } from '../utils/temperatureFormat';

const RANGES = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

/**
 * Print needs deterministic geometry, so the chart is sized in absolute px
 * rather than through ResponsiveContainer (which measures a container that has
 * no stable width in a print layout). 720 px keeps it inside a portrait A4/
 * Letter text column at default margins.
 */
const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;

/**
 * The report is a paper document: it always draws on white with the light
 * palette, whichever theme the app is in, so what is on screen is what comes
 * out of the printer. (The surrounding page chrome stays themed.) Hence the
 * light palette by direct reference rather than through useChartColors() — and
 * never a second copy of the hex values, which would drift from the theme.
 */
const PAPER_CHART_COLORS = LIGHT_CHART_COLORS;

export function PatientReportPage() {
  const { patientId = '' } = useParams();
  const [rangeHours, setRangeHours] = useState(24);

  const patientsQuery = useDoctorPatients();
  const summaryQuery = useDoctorPatientsSummary(rangeHours);
  const meQuery = useMe();
  const notesQuery = useCareNotes(patientId);
  const thresholdsQuery = useResolvedThresholds(patientId);

  const patient = (patientsQuery.data ?? []).find((p) => p.patientUserId === patientId) ?? null;
  const summary = (summaryQuery.data ?? []).find((p) => p.patientUserId === patientId) ?? null;
  const historyQuery = useMeasurementHistory(patient?.deviceBdAddr ?? null, { kind: 'sliding', hours: rangeHours });
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';

  /**
   * The app chrome is not part of the document. NavBar is owned by the router
   * shell, so instead of prop-drilling a "hide me" flag this page marks the
   * body while it is mounted and `@media print` in index.css keys off that —
   * printing any other page is unaffected.
   */
  useEffect(() => {
    document.body.classList.add('report-print-mode');
    return () => document.body.classList.remove('report-print-mode');
  }, []);

  const points = useMemo<TemperatureSeriesPoint[]>(
    () =>
      [...(historyQuery.data ?? [])]
        // Backend returns newest-first; a report reads oldest-first.
        .reverse()
        .filter((m) => m.valueNum !== null)
        .map((m) => {
          const celsius = m.valueNum as number;
          return { ts: new Date(m.ts).getTime(), celsius, value: convertFromCelsius(celsius, unit) };
        }),
    [historyQuery.data, unit],
  );

  const buckets = useMemo(() => bucketReadings(points, bucketMsFor(rangeHours)), [points, rangeHours]);

  if (patientsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <SkeletonBlock className="h-64" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <Card density="compact">
          <EmptyState
            icon={Users}
            title="Patient not found"
            description="This patient may have withdrawn your access."
          />
        </Card>
      </div>
    );
  }

  const patientName = patient.patientUsername ?? patient.patientUserId;
  const rangeLabel = RANGES.find((r) => r.hours === rangeHours)?.label ?? `${rangeHours} hours`;
  const clinician = meQuery.data?.displayName ?? meQuery.data?.username ?? '—';
  const thresholds = thresholdsQuery.data ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link
          to={`/patients?patient=${encodeURIComponent(patient.patientUserId)}`}
          className="inline-flex items-center gap-1.5 text-body font-semibold text-primary-600 hover:underline dark:text-primary-300"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to patient
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.hours}
                size="sm"
                variant={rangeHours === r.hours ? 'primary' : 'tertiary'}
                onClick={() => setRangeHours(r.hours)}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            Print
          </Button>
        </div>
      </div>

      <Card density="compact" className="print-avoid-break">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-display font-semibold text-ink-primary">Clinical report</h1>
            <p className="text-body text-ink-secondary">
              {patientName} · {rangeLabel}
            </p>
          </div>
          {summary && <RiskBadge tier={summary.riskTier} score={summary.riskScore} />}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-body sm:grid-cols-3">
          <ReportField label="Patient" value={patientName} />
          <ReportField label="Device" value={patient.deviceBdAddr ? `${patient.deviceModel} · ${patient.deviceBdAddr}` : 'none claimed'} />
          <ReportField label="Readings" value={summary ? String(summary.readingCount) : '—'} />
          <ReportField label="Prepared by" value={clinician} />
          <ReportField label="Generated" value={new Date().toLocaleString()} />
          <ReportField
            label="Alert scale"
            value={
              thresholds
                ? `${formatTemperature(thresholds.normalStartC, unit)} normal · ${formatTemperature(thresholds.elevatedStartC, unit)} elevated · ${formatTemperature(thresholds.feverStartC, unit)} fever · ${formatTemperature(thresholds.highFeverStartC, unit)} high fever (${thresholds.source.replace('_', ' ')})`
                : '—'
            }
          />
        </dl>
        <p className="mt-3 text-caption text-ink-muted">
          Engineering placeholder thresholds — not a medical assessment. Risk is a worklist ordering heuristic.
        </p>
      </Card>

      {summary && (
        <div className="print-avoid-break grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryTile label="Latest" value={formatTemperature(summary.latestCelsius, unit)} />
          <SummaryTile label="Average" value={formatTemperature(summary.avgCelsius, unit)} />
          <SummaryTile label="Minimum" value={formatTemperature(summary.minCelsius, unit)} />
          <SummaryTile label="Maximum" value={formatTemperature(summary.maxCelsius, unit)} />
          <SummaryTile label="Variability" value={formatTemperatureDelta(summary.stddevCelsius, unit)} />
        </div>
      )}

      <Card
        density="compact"
        className="print-avoid-break"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Temperature over {rangeLabel}</h2>}
      >
        {historyQuery.isLoading ? (
          <SkeletonBlock className="h-[260px]" />
        ) : (
          <ReportChart points={points} unit={unit} />
        )}
      </Card>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Readings summary</h2>}
      >
        {buckets.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-muted">No readings in this range.</p>
        ) : (
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Period</TableHeadCell>
                <TableHeadCell>Readings</TableHeadCell>
                <TableHeadCell>Min</TableHeadCell>
                <TableHeadCell>Avg</TableHeadCell>
                <TableHeadCell>Max</TableHeadCell>
                <TableHeadCell>Peak status</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {buckets.map((bucket) => (
                <TableRow key={bucket.startMs}>
                  <TableCell>{new Date(bucket.startMs).toLocaleString()}</TableCell>
                  <TableCell mono muted>
                    {bucket.count}
                  </TableCell>
                  <TableCell mono>{formatTemperature(bucket.minCelsius, unit, 2)}</TableCell>
                  <TableCell mono>{formatTemperature(bucket.avgCelsius, unit, 2)}</TableCell>
                  <TableCell mono>{formatTemperature(bucket.maxCelsius, unit, 2)}</TableCell>
                  <TableCell>
                    <TemperatureBadge tier={bucket.peakTier} label={getTemperatureTier(bucket.maxCelsius).label} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card
        density="compact"
        header={
          <div>
            <h2 className="text-h3 font-semibold text-ink-primary">Care notes</h2>
            <p className="text-caption text-ink-muted">Your private notes about this patient, oldest first.</p>
          </div>
        }
      >
        {notesQuery.isLoading ? (
          <SkeletonBlock className="h-24" />
        ) : (notesQuery.data ?? []).length === 0 ? (
          <p className="py-4 text-center text-body text-ink-muted">No notes recorded.</p>
        ) : (
          <ol className="space-y-3">
            {[...(notesQuery.data ?? [])]
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((note) => (
                <li
                  key={note.id}
                  className="print-avoid-break rounded-md border border-border-hairline p-3 dark:border-border-hairline/[0.08]"
                >
                  <div className="text-caption text-ink-muted">
                    {note.doctorUsername ?? 'You'} · {new Date(note.createdAt).toLocaleString()}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-body text-ink-primary">{note.note}</p>
                </li>
              ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function ReportField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-body text-ink-primary">{value}</dd>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card density="compact">
      <div className="text-label uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-tabular text-h3 font-semibold text-ink-primary">{value}</div>
    </Card>
  );
}

/**
 * Fixed-size, non-interactive twin of TemperatureChart: no ResponsiveContainer,
 * no Brush, no step buttons — a print layout needs a chart that measures the
 * same on paper as it does on screen.
 */
function ReportChart({ points, unit }: { points: TemperatureSeriesPoint[]; unit: TemperatureUnit }) {
  if (points.length < 2) {
    return <p className="py-12 text-center text-body text-ink-muted">Not enough readings to plot in this range.</p>;
  }

  const start = points[0].ts;
  const end = points[points.length - 1].ts;
  const yDomain = computeYDomain([{ id: 'report', label: 'Temperature', color: PAPER_CHART_COLORS.line, points }], start, end, unit);

  return (
    <div className="overflow-x-auto">
      {/* White plot sheet in both themes — see PAPER_CHART_COLORS. */}
      <div className="inline-block rounded-md bg-white p-2">
        <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={PAPER_CHART_COLORS.grid} vertical={false} />
          {yDomain &&
            TEMPERATURE_TIER_BANDS.map((band) => {
              const from = Math.max(convertFromCelsius(band.min, unit), yDomain[0]);
              const to = Math.min(convertFromCelsius(band.max, unit), yDomain[1]);
              if (!(to > from)) return null;
              return (
                <ReferenceArea
                  key={band.tier}
                  y1={from}
                  y2={to}
                  fill={PAPER_CHART_COLORS.tierFill[band.tier]}
                  fillOpacity={0.85}
                  strokeWidth={0}
                  ifOverflow="hidden"
                />
              );
            })}
          <XAxis
            dataKey="ts"
            type="number"
            domain={[start, end]}
            allowDataOverflow
            tickFormatter={(ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            tick={{ fontSize: 11, fill: PAPER_CHART_COLORS.axis }}
            tickLine={false}
            axisLine={{ stroke: PAPER_CHART_COLORS.grid }}
          />
          <YAxis
            domain={yDomain ?? ['auto', 'auto']}
            allowDataOverflow
            tickFormatter={(value: number) => `${value.toFixed(1)}${unitSuffix(unit)}`}
            tick={{ fontSize: 11, fill: PAPER_CHART_COLORS.axis }}
            width={64}
            tickLine={false}
            axisLine={{ stroke: PAPER_CHART_COLORS.grid }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={PAPER_CHART_COLORS.line}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </div>
    </div>
  );
}
