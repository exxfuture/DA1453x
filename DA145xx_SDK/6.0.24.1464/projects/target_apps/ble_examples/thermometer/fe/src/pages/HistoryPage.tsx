import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bluetooth } from 'lucide-react';
import { TemperatureEventResponse } from '../api/client';
import { useDeviceEvents, useDevices, useMe } from '../api/queries';
import { useSelectedDevice } from '../hooks/useSelectedDevice';
import { deviceDisplayName } from '../utils/devices';
import { TIER_ICON, TIER_LABEL } from '../theme/temperature';
import { convertFromCelsius, unitSuffix } from '../utils/temperature';
import { formatDuration } from '../utils/time';
import type { TimeWindow } from '../utils/timeWindow';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';
import { Select } from '../components/ui/Select';
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

  const devices = devicesQuery.data ?? [];

  // Same remembered + revalidated choice as the Dashboard, from the shared hook
  // (review FE-20): whichever device was last looked at anywhere is the one
  // both pages open on.
  const { selectedBdAddr, setSelectedBdAddr } = useSelectedDevice(devices);

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
            <Select
              value={selectedBdAddr ?? ''}
              onChange={(e) => setSelectedBdAddr(e.target.value)}
              aria-label="Device"
            >
              {devices.map((d) => (
                <option key={d.bdAddr} value={d.bdAddr}>
                  {deviceDisplayName(d)} ({d.bdAddr})
                </option>
              ))}
            </Select>
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
