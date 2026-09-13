import { useRef, useState } from 'react';
import { Check, Pencil, Smartphone } from 'lucide-react';
import { DeviceResponse } from '../api/client';
import { useAvailableDevices, useClaimDevice, useDevices, useReleaseDevice, useRenameDevice } from '../api/queries';
import { deviceDisplayName } from '../utils/devices';
import { useUiPreferences } from '../state/uiStore';
import { relativeTime } from '../utils/time';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { Badge, type BadgeStatus } from '../components/ui/Badge';
import { DeviceList, DeviceListItem } from '../components/ui/DeviceList';
import { EmptyState, SkeletonBlock } from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';

/**
 * The firmware measures every 5 s by default and every 300 s at its slowest
 * configurable interval (see the project README), so a quarter of an hour of
 * silence is already dozens of missed readings — the link is down, not slow.
 */
const QUIET_AFTER_MS = 15 * 60_000;

/**
 * Beyond this a device is called offline outright. Matches the backend's own
 * staleness window (the `stale` flag on the doctor's patient summary), so
 * both sides of the platform agree on when a device has gone dark.
 */
const OFFLINE_AFTER_MS = 6 * 3_600_000;

interface DeviceHealth {
  status: BadgeStatus;
  label: string;
  lastSeenText: string;
}

function deviceHealth(device: DeviceResponse, now: number): DeviceHealth {
  if (!device.lastSeenAt) {
    return { status: 'warning', label: 'No readings yet', lastSeenText: 'Never reported' };
  }

  const age = now - new Date(device.lastSeenAt).getTime();
  const lastSeenText = `Last reading ${relativeTime(device.lastSeenAt, now)}${
    device.lastSeenType ? ` (${device.lastSeenType})` : ''
  }`;

  if (age > OFFLINE_AFTER_MS) return { status: 'danger', label: 'Offline', lastSeenText };
  if (age > QUIET_AFTER_MS) return { status: 'warning', label: 'No recent readings', lastSeenText };
  return { status: 'success', label: 'Reporting', lastSeenText };
}

/** One owned device row, including the inline rename affordance. Editing
 *  state is local to the row so renaming one card never disturbs the others. */
function OwnedDeviceRow({ device, highlighted }: { device: DeviceResponse; highlighted: boolean }) {
  const releaseDevice = useReleaseDevice();
  const renameDevice = useRenameDevice();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const health = deviceHealth(device, Date.now());

  const beginRename = () => {
    setDraft(device.label ?? '');
    setEditing(true);
    // Focus after mount — the input only exists once `editing` renders.
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitRename = () => {
    renameDevice.mutate(
      { bdAddr: device.bdAddr, label: draft },
      {
        onSuccess: () => {
          setEditing(false);
        },
        // Keep the editor open on failure so the user can retry or cancel
        // instead of retyping into a closed form.
      },
    );
  };

  return (
    <DeviceListItem
      highlighted={highlighted}
      subtitle={device.bdAddr}
      actions={
        editing ? (
          <>
            <Button size="sm" onClick={commitRename} loading={renameDevice.isPending} aria-label="Save name">
              <Check className="size-4" aria-hidden />
              Save
            </Button>
            <Button size="sm" variant="tertiary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="tertiary" onClick={beginRename}>
              <Pencil className="size-4" aria-hidden />
              Rename
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => releaseDevice.mutate(device.bdAddr)}
              loading={releaseDevice.isPending}
            >
              Release
            </Button>
          </>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            maxLength={64}
            placeholder={`e.g. ${device.model}`}
            aria-label={`Name for device ${device.bdAddr}`}
            className="h-touch w-full max-w-xs rounded-md border border-primary-500 bg-surface-1 px-3 text-body text-ink-primary focus-visible:outline-none focus-visible:border-primary-600 focus-visible:shadow-focus"
          />
          {renameDevice.isError && (
            <span role="status" className="text-caption text-danger-text">
              Could not save the name — try again.
            </span>
          )}
        </div>
      ) : (
        deviceDisplayName(device)
      )}
      <>
        <Badge status={health.status}>{health.label}</Badge>
        <span>{health.lastSeenText}</span>
        {device.claimedAt && <span>claimed {new Date(device.claimedAt).toLocaleDateString()}</span>}
      </>
    </DeviceListItem>
  );
}

export function DevicesPage() {
  const devicesQuery = useDevices();
  const availableQuery = useAvailableDevices();
  const claimDevice = useClaimDevice();
  const highlightedBdAddr = useUiPreferences((s) => s.lastDeviceBdAddr);

  const myDevices = devicesQuery.data ?? [];
  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
      <h1 className="font-display text-display font-semibold text-ink-primary">Devices</h1>

      <section className="space-y-2" aria-labelledby="your-devices-heading">
        <h2 id="your-devices-heading" className="text-h3 font-semibold text-ink-primary">
          Your devices
        </h2>
        <p className="text-caption text-ink-muted">
          Give each device a name you&apos;ll recognise — it shows up in your dashboard picker instead of the
          Bluetooth address.
        </p>
        {devicesQuery.isLoading ? (
          <SkeletonBlock className="h-20" />
        ) : myDevices.length === 0 ? (
          <Card density="compact">
            <EmptyState icon={Smartphone} title="No devices claimed yet" description="Claim one below to start tracking." />
          </Card>
        ) : (
          <DeviceList>
            {myDevices.map((device) => (
              <OwnedDeviceRow key={device.bdAddr} device={device} highlighted={highlightedBdAddr === device.bdAddr} />
            ))}
          </DeviceList>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="available-devices-heading">
        <h2 id="available-devices-heading" className="text-h3 font-semibold text-ink-primary">
          Available devices
        </h2>
        <p className="text-caption text-ink-muted">
          You can claim as many devices as you like — the simulated fleet self-registers here as it starts publishing.
        </p>
        {claimDevice.isError && <Alert status="danger">Could not claim that device — someone else claimed it first.</Alert>}
        {availableQuery.isLoading && <SkeletonBlock className="h-16" />}
        {availableQuery.data?.length === 0 && (
          <Card density="compact">
            <EmptyState icon={Smartphone} title="No unclaimed devices right now" description="Check back shortly — new devices come online periodically." />
          </Card>
        )}
        <DeviceList>
          {availableQuery.data?.map((device) => (
            <DeviceListItem
              key={device.bdAddr}
              subtitle={device.bdAddr}
              actions={
                <Button size="sm" onClick={() => claimDevice.mutate({ bdAddr: device.bdAddr })} loading={claimDevice.isPending}>
                  Claim
                </Button>
              }
            >
              {device.model}
            </DeviceListItem>
          ))}
        </DeviceList>
      </section>
    </div>
  );
}
