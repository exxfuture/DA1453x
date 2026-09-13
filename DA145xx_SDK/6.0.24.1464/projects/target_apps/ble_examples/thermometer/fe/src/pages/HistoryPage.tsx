import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bluetooth, Flame } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TemperatureEventResponse } from '../api/client';
import { useDeviceEvents, useDevices, useMe } from '../api/queries';
import { useUiPreferences } from '../state/uiStore';
import { deviceDisplayName, resolveSelectedBdAddr } from '../utils/devices';
import { TEMPERATURE_TIER_BANDS, type TemperatureTier } from '../theme/temperature';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import type { TimeWindow } from '../utils/timeWindow';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';
import { Timeline, type TimelineItem } from '../components/ui/Timeline';
import { TimeWindowPicker } from '../components/TimeWindowPicker';

/**
 * Episodes are coarse, hours-to-days objects, so the ranges start where the
 * dashboard's stop. The backend caps any window at 90 days.
 */
const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

const TIER_LABEL: Record<TemperatureTier, string> = Object.fromEntries(
  TEMPERATURE_TIER_BANDS.map((band) => [band.tier, band.label]),
) as Record<TemperatureTier, string>;

/** Only the three raised tiers can appear in an episode; the rest are defensive. */
const TIER_ICON: Record<TemperatureTier, LucideIcon> = {
  low: AlertTriangle,
  normal: AlertTriangle,
  elevated: AlertTriangle,
  fever: Flame,
  highFever: Flame,
};

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days} d` : `${days} d ${leftoverHours} h`;
}

function toTimelineItem(event: TemperatureEventResponse, unit: 'CELSIUS' | 'FAHRENHEIT'): TimelineItem {
  const start = new Date(event.startTs).getTime();
  const end = new Date(event.endTs).getTime();
  return {
    id: `${event.deviceBdAddr}-${event.startTs}`,
    icon: TIER_ICON[event.tier],
    label: TIER_LABEL[event.tier] ?? event.tier,
    detail: `Peak ${convertFromCelsius(event.peakCelsius, unit).toFixed(2)} ${unitSuffix(unit)} · lasted ${formatDuration(
      end - start,
    )} · ${event.readingCount} reading${event.readingCount === 1 ? '' : 's'}`,
    timestamp: start,
  };
}

/**
 * Fever/threshold event history (customer feature #2).
 *
 * Episodes are detected server-side against whichever alert scale is in
 * effect for this customer (their own thresholds, a doctor's override, or the
 * system default) — so editing thresholds in Settings changes what shows up
 * here.
 */
export function HistoryPage() {
  const devicesQuery = useDevices();
  const meQuery = useMe();
  const unit = meQuery.data?.temperatureUnit ?? 'CELSIUS';
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({ kind: 'sliding', hours: 24 * 7 });
  const lastDeviceBdAddr = useUiPreferences((s) => s.lastDeviceBdAddr);
  const setLastDeviceBdAddr = useUiPreferences((s) => s.setLastDeviceBdAddr);
  const [selectedBdAddr, setSelectedBdAddr] = useState<string | null>(null);

  const devices = devicesQuery.data ?? [];

  // Same selection-reconciliation as the dashboard — including the shared
  // remembered choice: whichever device was last looked at anywhere is the
  // one these pages open on.
  useEffect(() => {
    setSelectedBdAddr(resolveSelectedBdAddr(devices, selectedBdAddr ?? lastDeviceBdAddr));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when the device set changes
  }, [devices.map((d) => d.bdAddr).join(',')]);

  useEffect(() => {
    if (selectedBdAddr) {
      setLastDeviceBdAddr(selectedBdAddr);
    }
  }, [selectedBdAddr, setLastDeviceBdAddr]);

  const device = devices.find((d) => d.bdAddr === selectedBdAddr) ?? null;
  const eventsQuery = useDeviceEvents(device?.bdAddr ?? null, timeWindow);

  const items = useMemo(
    // Newest first — the most recent episode is the one being looked for.
    () =>
      [...(eventsQuery.data ?? [])]
        .sort((a, b) => new Date(b.startTs).getTime() - new Date(a.startTs).getTime())
        .map((event) => toTimelineItem(event, unit)),
    [eventsQuery.data, unit],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <h1 className="font-display text-display font-semibold text-ink-primary">Fever history</h1>

      {devicesQuery.isLoading ? (
        <SkeletonBlock className="h-40" />
      ) : !device ? (
        <Card>
          <EmptyState
            icon={Bluetooth}
            title="You haven't claimed a device yet"
            description="Claim a thermometer to build up a history of raised readings."
          />
          <div className="flex justify-center">
            <Link to="/devices">
              <Button variant="warm">Browse available devices</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {devices.length > 1 && (
            <select
              className="h-touch w-full cursor-pointer rounded-md border border-sand-500 bg-surface-1 px-3 text-body text-ink-primary transition-colors duration-fast ease-standard hover:border-sand-600 dark:border-sand-600 dark:hover:border-sand-400 focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus"
              value={selectedBdAddr ?? ''}
              onChange={(e) => setSelectedBdAddr(e.target.value)}
              aria-label="Device"
            >
              {devices.map((d) => (
                <option key={d.bdAddr} value={d.bdAddr}>
                  {deviceDisplayName(d)} ({d.bdAddr})
                </option>
              ))}
            </select>
          )}

          <Card
            density="compact"
            header={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-h3 font-semibold text-ink-primary">Raised-temperature episodes</h2>
                <TimeWindowPicker presets={RANGES} value={timeWindow} onChange={setTimeWindow} />
              </div>
            }
          >
            <p className="mb-4 text-caption text-ink-muted">
              An episode is a run of readings above your normal range. The cut points come from your alert
              thresholds — change them in{' '}
              <Link to="/settings" className="font-semibold text-primary-600 hover:underline dark:text-primary-300">
                Settings
              </Link>
              .
            </p>

            {eventsQuery.isError && (
              <Alert status="danger" className="mb-3">
                Could not load your history — please try again.
              </Alert>
            )}

            {eventsQuery.isLoading ? (
              <SkeletonBlock className="h-40" />
            ) : (
              <Timeline items={items} emptyText="No raised readings in this range — nothing to report." />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
