import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Flame,
  RefreshCw,
  Search,
  Thermometer,
  Users,
  WifiOff,
} from 'lucide-react';
import { PatientSummaryResponse, TemperatureUnit } from '../../api/client';
import { useDoctorPatientsSummary, useMe } from '../../api/queries';
import { Badge, TemperatureBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { StatTile } from '../../components/ui/StatTile';
import { computeTrend, RiskBadge, RISK_RANK, TrendArrow } from '../../components/PatientTriage';
import { Sparkline } from '../../components/Sparkline';
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableHeadRow, TableRow } from '../../components/ui/Table';
import { getTemperatureTier, TemperatureTier } from '../../theme/temperature';
import { formatTemperature, formatTemperatureDelta } from '../../utils/temperatureFormat';
import { relativeTime } from '../../utils/time';

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

type StatusFilter = 'all' | 'attention' | 'noDevice' | 'stale';
type SortKey = 'risk' | 'sick' | 'recent' | 'name';

function tierOf(celsius: number | null): TemperatureTier | null {
  return celsius != null ? getTemperatureTier(celsius).tier : null;
}

function needsAttention(patient: PatientSummaryResponse): boolean {
  const tier = tierOf(patient.latestCelsius);
  return tier === 'fever' || tier === 'highFever';
}

function displayName(patient: { patientUsername: string | null; patientUserId: string }): string {
  return patient.patientUsername ?? patient.patientUserId;
}

/**
 * Text equivalent of a patient's sparkline (review FE-18).
 *
 * The trend line is a primary at-a-glance clinical signal on this table, and an
 * aria-hidden SVG in a bare cell made it invisible to a screen reader. The shape
 * of a line can't be spoken, so this gives what the shape is read *for*: the
 * range it covers and how many readings it is drawn from.
 */
function sparklineSummary(patient: PatientSummaryResponse, unit: TemperatureUnit, rangeLabel: string): string {
  if (patient.sparkline.length < 2) return 'Trend: not enough readings to plot.';
  const values = patient.sparkline.map((point) => point.celsius);
  const low = formatTemperature(Math.min(...values), unit);
  const high = formatTemperature(Math.max(...values), unit);
  return `Trend over ${rangeLabel}: ranged from ${low} to ${high} across ${patient.sparkline.length} readings.`;
}

export function DoctorDashboardPage() {
  const [rangeHours, setRangeHours] = useState(24);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('risk');

  const summaryQuery = useDoctorPatientsSummary(rangeHours);
  const meQuery = useMe();
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';

  // Memoised so it is the same array identity between renders: several
  // useMemo/useEffect hooks below depend on it, and `?? []` would hand them a
  // fresh empty array on every render (react-hooks/exhaustive-deps, review FE-08).
  const patients = useMemo(() => summaryQuery.data ?? [], [summaryQuery.data]);

  const stats = useMemo(() => {
    const withDevice = patients.filter((p) => p.deviceBdAddr != null);
    const reporting = withDevice.filter((p) => p.readingCount > 0);
    const attention = patients.filter(needsAttention);
    const withAvg = patients.filter((p) => p.avgCelsius != null);
    const fleetAvg = withAvg.length
      ? withAvg.reduce((sum, p) => sum + (p.avgCelsius as number), 0) / withAvg.length
      : null;
    return {
      total: patients.length,
      withDeviceCount: withDevice.length,
      reportingCount: reporting.length,
      attention,
      fleetAvg,
    };
  }, [patients]);

  /**
   * Devices that have gone quiet, plus patients who never claimed one — the
   * proactive-outreach list. Staleness is the backend's `stale` flag (one
   * consistent window across every client), never a locally guessed cutoff.
   */
  const unreliable = useMemo(
    () =>
      patients
        .filter((p) => p.deviceBdAddr == null || p.stale)
        .map((p) => ({ patient: p, reason: p.deviceBdAddr == null ? ('noDevice' as const) : ('silent' as const) }))
        .sort((a, b) => {
          // Silent devices first (something broke); never-claimed is older news.
          if (a.reason !== b.reason) return a.reason === 'silent' ? -1 : 1;
          const at = a.patient.latestAt ? new Date(a.patient.latestAt).getTime() : -Infinity;
          const bt = b.patient.latestAt ? new Date(b.patient.latestAt).getTime() : -Infinity;
          return bt - at;
        }),
    [patients],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    let rows = patients.filter((p) => {
      if (query && !displayName(p).toLowerCase().includes(query)) return false;
      if (statusFilter === 'attention' && !needsAttention(p)) return false;
      if (statusFilter === 'noDevice' && p.deviceBdAddr != null) return false;
      if (statusFilter === 'stale' && !p.stale) return false;
      return true;
    });

    rows = [...rows].sort((a, b) => {
      if (sortKey === 'name') {
        return displayName(a).localeCompare(displayName(b));
      }
      if (sortKey === 'recent') {
        const at = a.latestAt ? new Date(a.latestAt).getTime() : -Infinity;
        const bt = b.latestAt ? new Date(b.latestAt).getTime() : -Infinity;
        return bt - at;
      }
      if (sortKey === 'risk') {
        // Tier first so the badge order on screen is never contradicted by a
        // score that straddles a tier boundary; score breaks ties within it.
        const byTier = RISK_RANK[a.riskTier] - RISK_RANK[b.riskTier];
        return byTier !== 0 ? byTier : b.riskScore - a.riskScore;
      }
      // 'sick' — highest average temperature over the selected range first; no data sinks to the bottom.
      const aAvg = a.avgCelsius ?? -Infinity;
      const bAvg = b.avgCelsius ?? -Infinity;
      return bAvg - aAvg;
    });

    return rows;
  }, [patients, search, statusFilter, sortKey]);

  const isLoading = summaryQuery.isLoading;
  const rangeLabel = RANGES.find((r) => r.hours === rangeHours)?.label ?? `${rangeHours}h`;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-display font-semibold text-ink-primary">Dashboard</h1>
          <p className="text-caption text-ink-muted">Your patients at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.label}
                size="sm"
                variant={rangeHours === r.hours ? 'primary' : 'tertiary'}
                onClick={() => setRangeHours(r.hours)}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => summaryQuery.refetch()}
            loading={summaryQuery.isFetching && !summaryQuery.isLoading}
            aria-label="Refresh"
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
      )}

      {!isLoading && patients.length === 0 && (
        <Card density="compact">
          <EmptyState icon={Users} title="No patients have granted you access yet." />
        </Card>
      )}

      {!isLoading && patients.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={Users} label="Total patients" value={String(stats.total)} />
            <StatTile
              icon={Activity}
              label="Reporting data"
              value={`${stats.reportingCount} / ${stats.withDeviceCount}`}
              hint={stats.withDeviceCount < stats.total ? `${stats.total - stats.withDeviceCount} without a device` : undefined}
            />
            <StatTile
              icon={Flame}
              label="Needs attention"
              value={String(stats.attention.length)}
              tone={stats.attention.length > 0 ? 'danger' : undefined}
            />
            <StatTile
              icon={Thermometer}
              label={`Fleet avg (${rangeLabel})`}
              value={formatTemperature(stats.fleetAvg, unit)}
            />
          </div>

          {stats.attention.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-tint p-3 text-danger-text">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="text-body">
                <span className="font-semibold">
                  {stats.attention.length} patient{stats.attention.length === 1 ? '' : 's'} running a fever:
                </span>{' '}
                {stats.attention.map(displayName).slice(0, 6).join(', ')}
                {stats.attention.length > 6 ? `, +${stats.attention.length - 6} more` : ''}
              </div>
            </div>
          )}

          <Card density="compact">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                <Input
                  placeholder="Search patients…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  aria-label="Search patients"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['all', 'All'],
                    ['attention', 'Needs attention'],
                    ['noDevice', 'No device'],
                    ['stale', 'Stale'],
                  ] as [StatusFilter, string][]
                ).map(([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={statusFilter === key ? 'primary' : 'tertiary'}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Select
                aria-label="Sort by"
                size="sm"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="risk">Sort: Risk</option>
                <option value="sick">Sort: Most sick</option>
                <option value="recent">Sort: Most recent</option>
                <option value="name">Sort: Name</option>
              </Select>
            </div>
          </Card>

          {visible.length === 0 ? (
            <Card density="compact">
              <EmptyState icon={Search} title="No patients match your filters." />
            </Card>
          ) : (
            <Card density="compact">
              <Table>
                <TableHead>
                  <TableHeadRow>
                    <TableHeadCell>Patient</TableHeadCell>
                    <TableHeadCell>Risk</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell>Latest</TableHeadCell>
                    <TableHeadCell>History</TableHeadCell>
                    <TableHeadCell>Avg / Min / Max</TableHeadCell>
                    <TableHeadCell title="Standard deviation over the selected range">Variability</TableHeadCell>
                    <TableHeadCell>Device</TableHeadCell>
                    <TableHeadCell>Updated</TableHeadCell>
                    <TableHeadCell aria-label="Actions" />
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {visible.map((p) => {
                    const tier = tierOf(p.latestCelsius);
                    const trend = computeTrend(p.latestCelsius, p.avgCelsius);
                    return (
                      <TableRow key={p.patientUserId}>
                        <TableCell className="font-semibold text-ink-primary">{displayName(p)}</TableCell>
                        <TableCell>
                          <RiskBadge tier={p.riskTier} score={p.riskScore} />
                        </TableCell>
                        <TableCell>
                          {tier ? (
                            <TemperatureBadge tier={tier} label={getTemperatureTier(p.latestCelsius as number).label} />
                          ) : (
                            <Badge status="neutral">No data</Badge>
                          )}
                          {p.stale && p.deviceBdAddr && (
                            <Badge status="warning" className="ml-1">
                              Stale
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell mono>
                          <span className="inline-flex items-center gap-1.5">
                            {formatTemperature(p.latestCelsius, unit)}
                            {trend && <TrendArrow trend={trend} />}
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* The SVG itself is aria-hidden (decorative), so the
                              cell carries the same information as text for
                              screen readers — review FE-18. */}
                          <Sparkline points={p.sparkline} label={sparklineSummary(p, unit, rangeLabel)} />
                        </TableCell>
                        <TableCell mono muted>
                          {formatTemperature(p.avgCelsius, unit)} / {formatTemperature(p.minCelsius, unit)} /{' '}
                          {formatTemperature(p.maxCelsius, unit)}
                        </TableCell>
                        <TableCell mono muted>
                          {p.stddevCelsius != null ? `± ${formatTemperatureDelta(p.stddevCelsius, unit)}` : '—'}
                        </TableCell>
                        <TableCell muted>
                          {p.deviceBdAddr ? p.deviceModel : <span className="italic">no device claimed</span>}
                        </TableCell>
                        <TableCell muted>{relativeTime(p.latestAt)}</TableCell>
                        <TableCell>
                          {p.deviceBdAddr && (
                            <Link
                              to={`/patients?patient=${encodeURIComponent(p.patientUserId)}`}
                              className="inline-flex items-center gap-0.5 text-body font-semibold text-primary-600 hover:underline dark:text-primary-300"
                            >
                              View <ChevronRight className="size-4" aria-hidden />
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {unreliable.length > 0 && (
            <Card
              density="compact"
              header={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink-primary">
                    <WifiOff className="size-4 text-warning-text" aria-hidden />
                    Device reliability
                  </h2>
                  <span className="text-caption text-ink-muted">
                    {unreliable.length} of {stats.total} patients are not sending data
                  </span>
                </div>
              }
            >
              <Table>
                <TableHead>
                  <TableHeadRow>
                    <TableHeadCell>Patient</TableHeadCell>
                    <TableHeadCell>Issue</TableHeadCell>
                    <TableHeadCell>Device</TableHeadCell>
                    <TableHeadCell>Last reading</TableHeadCell>
                    <TableHeadCell>Readings ({rangeLabel})</TableHeadCell>
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {unreliable.map(({ patient, reason }) => (
                    <TableRow key={patient.patientUserId}>
                      <TableCell className="font-semibold text-ink-primary">{displayName(patient)}</TableCell>
                      <TableCell>
                        {reason === 'silent' ? (
                          <Badge status="warning">Device silent</Badge>
                        ) : (
                          <Badge status="neutral">No device claimed</Badge>
                        )}
                      </TableCell>
                      <TableCell muted>{patient.deviceBdAddr ?? '—'}</TableCell>
                      <TableCell muted>{relativeTime(patient.latestAt)}</TableCell>
                      <TableCell mono muted>
                        {patient.readingCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
