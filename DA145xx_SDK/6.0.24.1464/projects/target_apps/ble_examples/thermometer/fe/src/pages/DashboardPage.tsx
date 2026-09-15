import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bluetooth, Download, History, Layers } from 'lucide-react';
import { MeasurementChart } from '../components/MeasurementChart';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { ReadingNotes, type SelectedReading } from '../components/ReadingNotes';
import { TemperatureChart, type TemperatureSeries } from '../components/TemperatureChart';
import { TimeWindowPicker } from '../components/TimeWindowPicker';
import { TrendInsightCard } from '../components/TrendInsightCard';
import { MeasurementResponse } from '../api/client';
import { useAnnotations, useDevices, useMe, useMeasurementHistory } from '../api/queries';
import { useSelectedDevice } from '../hooks/useSelectedDevice';
import { deviceDisplayName } from '../utils/devices';
import { useMeasurementHistories } from '../api/useMeasurementHistories';
import { MAX_OVERLAY_SERIES, useChartColors } from '../theme/chartColors';
import { downloadCsv } from '../utils/csv';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import { timeWindowHours, timeWindowKey, timeWindowLabel, type TimeWindow } from '../utils/timeWindow';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatCard } from '../components/ui/StatCard';
import { Select } from '../components/ui/Select';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
];

/** BD addresses contain colons, which Windows rejects in filenames. */
function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function DashboardPage() {
  const devicesQuery = useDevices();
  const meQuery = useMe();
  const colors = useChartColors();
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({ kind: 'sliding', hours: 24 });
  const [compareBdAddrs, setCompareBdAddrs] = useState<string[] | null>(null);
  const [selectedReading, setSelectedReading] = useState<SelectedReading | null>(null);

  // Memoised so it is the same array identity between renders: several
  // useMemo/useEffect hooks below depend on it, and `?? []` would hand them a
  // fresh empty array on every render (react-hooks/exhaustive-deps, review FE-08).
  const devices = useMemo(() => devicesQuery.data ?? [], [devicesQuery.data]);
  const comparing = compareBdAddrs !== null;

  // Remembered + revalidated device choice, shared with HistoryPage (review FE-20).
  const { selectedBdAddr, setSelectedBdAddr } = useSelectedDevice(devices);

  const device = devices.find((d) => d.bdAddr === selectedBdAddr) ?? null;
  // Paused in compare mode (review FE-10): nothing this query feeds is on
  // screen then, and compare mode brings its own 5 s queries — two overlapping
  // polling sets for as long as the overlay stays open is pure waste.
  const historyQuery = useMeasurementHistory(device?.bdAddr ?? null, timeWindow, { enabled: !comparing });
  const latest = historyQuery.data?.[0];
  // Same query ReadingNotes below makes (React Query dedupes it) — reused here
  // so the chart can mark each note's location without an extra fetch.
  const annotationsQuery = useAnnotations(device?.bdAddr ?? null, timeWindow);
  const chartAnnotations = useMemo(
    () => (annotationsQuery.data ?? []).map((a) => ({ id: a.id, ts: new Date(a.tsFrom).getTime() })),
    [annotationsQuery.data],
  );

  // Empty list while not comparing: useQueries with no queries costs nothing,
  // and this keeps the hook order unconditional.
  const compareHistories = useMeasurementHistories(compareBdAddrs ?? [], timeWindow);

  const compareSeries = useMemo<TemperatureSeries[]>(
    () =>
      (compareBdAddrs ?? []).map((bdAddr, index) => {
        const device = devices.find((d) => d.bdAddr === bdAddr);
        // Backend returns newest-first; the chart reads left-to-right.
        const points = [...(compareHistories.byBdAddr[bdAddr] ?? [])]
          .reverse()
          .filter((m) => m.valueNum !== null)
          .map((m) => {
            const celsius = m.valueNum as number;
            return { ts: new Date(m.ts).getTime(), celsius, value: convertFromCelsius(celsius, unit) };
          });
        return {
          id: bdAddr,
          // A named device charts under its name; unnamed ones keep the old
          // "model — address" form so same-model devices stay distinguishable.
          label: device?.label ? deviceDisplayName(device) : device ? `${device.model} — ${bdAddr}` : bdAddr,
          color: colors.seriesPalette[index % colors.seriesPalette.length],
          points,
        };
      }),
    [compareBdAddrs, compareHistories.byBdAddr, devices, unit, colors.seriesPalette],
  );

  const toggleCompare = () => {
    setSelectedReading(null);
    setCompareBdAddrs((current) => {
      if (current !== null) return null;
      // Seed with the device already on screen plus the next one, so the
      // overlay is immediately meaningful instead of empty.
      const candidates = [selectedBdAddr, ...devices.map((d) => d.bdAddr)].filter(
        (bdAddr): bdAddr is string => bdAddr != null,
      );
      return [...new Set(candidates)].slice(0, 2);
    });
  };

  const toggleCompareDevice = (bdAddr: string) => {
    setCompareBdAddrs((current) => {
      if (current === null) return current;
      if (current.includes(bdAddr)) return current.filter((addr) => addr !== bdAddr);
      if (current.length >= MAX_OVERLAY_SERIES) return current;
      return [...current, bdAddr];
    });
  };

  // Built on demand rather than memoised: the rows are only ever needed the
  // instant the button is pressed, and rebuilding thousands of them on every
  // 5 s refetch would be pure waste.
  const handleExport = () => {
    const rows: Record<string, unknown>[] = [];
    const append = (bdAddr: string, data: MeasurementResponse[]) => {
      // Oldest-first in the file: that is the order a spreadsheet chart wants.
      for (const measurement of [...data].reverse()) {
        if (measurement.valueNum == null) continue;
        rows.push({
          ts: measurement.ts,
          device: bdAddr,
          celsius: measurement.valueNum,
          value: Number(convertFromCelsius(measurement.valueNum, unit).toFixed(2)),
          unit: unitSuffix(unit),
        });
      }
    };

    if (comparing) {
      for (const bdAddr of compareBdAddrs ?? []) append(bdAddr, compareHistories.byBdAddr[bdAddr] ?? []);
    } else if (device) {
      append(device.bdAddr, historyQuery.data ?? []);
    }

    const scope = comparing ? 'devices' : safeFilenamePart(device?.bdAddr ?? 'device');
    const presetLabel = timeWindow.kind === 'sliding' ? RANGES.find((r) => r.hours === timeWindow.hours)?.label : undefined;
    downloadCsv(`thermometer-${scope}-${timeWindowLabel(timeWindow, presetLabel)}`, rows);
  };

  const canExport = comparing
    ? compareSeries.some((series) => series.points.length > 0)
    : (historyQuery.data?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <h1 className="font-display text-display font-semibold text-ink-primary">Dashboard</h1>

      <OnboardingChecklist />

      {devicesQuery.isLoading ? (
        <SkeletonBlock className="h-40" />
      ) : !device ? (
        <Card>
          <EmptyState
            icon={Bluetooth}
            title="You haven't claimed a device yet"
            description="Connect your thermometer to start tracking your temperature."
          />
          <div className="flex justify-center">
            <Link to="/devices">
              <Button variant="warm">Browse available devices</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {devices.length > 1 && !comparing && (
            <Select
              aria-label="Device"
              value={selectedBdAddr ?? ''}
              onChange={(e) => {
                setSelectedBdAddr(e.target.value);
                setSelectedReading(null);
              }}
            >
              {devices.map((d) => (
                <option key={d.bdAddr} value={d.bdAddr}>
                  {deviceDisplayName(d)} ({d.bdAddr})
                </option>
              ))}
            </Select>
          )}

          {!comparing && (
            <>
              <StatCard
                label="Current temperature"
                celsius={latest?.valueNum ?? null}
                updatedAt={latest ? new Date(latest.ts) : null}
                unit={unit}
              />

              <TrendInsightCard data={historyQuery.data ?? []} unit={unit} rangeHours={timeWindowHours(timeWindow)} />
            </>
          )}

          <Card
            density="compact"
            header={
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-h3 font-semibold text-ink-primary">History</h2>
                  <TimeWindowPicker presets={RANGES} value={timeWindow} onChange={setTimeWindow} />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {devices.length > 1 && (
                    <Button size="sm" variant={comparing ? 'primary' : 'tertiary'} onClick={toggleCompare}>
                      <Layers className="size-4" aria-hidden />
                      {comparing ? 'Single device' : 'Compare devices'}
                    </Button>
                  )}
                  <Button size="sm" variant="tertiary" onClick={handleExport} disabled={!canExport}>
                    <Download className="size-4" aria-hidden />
                    Export CSV
                  </Button>
                  <Link to="/history" className="ml-auto">
                    <Button size="sm" variant="tertiary">
                      <History className="size-4" aria-hidden />
                      Fever history
                    </Button>
                  </Link>
                </div>
              </div>
            }
          >
            {comparing && (
              <fieldset className="mb-3 border-b border-border-hairline pb-3 dark:border-border-hairline/[0.08]">
                <legend className="text-label uppercase tracking-wide text-ink-secondary">
                  Devices to overlay (up to {MAX_OVERLAY_SERIES})
                </legend>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                  {devices.map((d) => {
                    const checked = (compareBdAddrs ?? []).includes(d.bdAddr);
                    return (
                      <label key={d.bdAddr} className="flex items-center gap-2 text-body text-ink-primary">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && (compareBdAddrs ?? []).length >= MAX_OVERLAY_SERIES}
                          onChange={() => toggleCompareDevice(d.bdAddr)}
                          className="size-4 accent-primary-600 disabled:opacity-40"
                        />
                        <span title={d.bdAddr}>{deviceDisplayName(d)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {(comparing ? compareHistories.isLoading : historyQuery.isLoading) ? (
              // 280 plot + 48 brush strip + 40 step-button row (see TemperatureChart).
              <SkeletonBlock className="h-[368px]" />
            ) : comparing ? (
              compareSeries.length === 0 ? (
                <p className="py-12 text-center text-body text-ink-muted">
                  Pick at least one device to overlay.
                </p>
              ) : (
                // Keyed by what is being charted: the zoom window is absolute
                // time, so it means nothing once a different set of devices —
                // or a different range — is on screen (see TemperatureChart).
                <TemperatureChart
                  key={`${compareSeries.map((s) => s.id).join('|')}:${timeWindowKey(timeWindow)}`}
                  series={compareSeries}
                  unit={unit}
                />
              )
            ) : (
              <MeasurementChart
                // Remount on a device or range switch so the zoom window doesn't
                // carry one device's absolute time slice over onto another's
                // data — or survive a range change and swallow it whole.
                key={`${device.bdAddr}:${timeWindowKey(timeWindow)}`}
                data={historyQuery.data ?? []}
                unit={unit}
                annotations={chartAnnotations}
                onPointClick={(row) => {
                  // Single-series chart, so the row holds exactly one reading —
                  // read it positionally rather than coupling to the series id.
                  const [point] = Object.values(row.points);
                  setSelectedReading({ ts: row.ts, celsius: point?.celsius ?? null });
                }}
              />
            )}
          </Card>

          {!comparing && (
            <ReadingNotes
              deviceBdAddr={device.bdAddr}
              window={timeWindow}
              unit={unit}
              selected={selectedReading}
              onClearSelection={() => setSelectedReading(null)}
              fallbackTs={latest ? new Date(latest.ts).getTime() : null}
            />
          )}
        </>
      )}
    </div>
  );
}
