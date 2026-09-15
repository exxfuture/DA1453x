import { useState } from 'react';
import { useAdminDeviceInventory, useAdminEditDevice, useAdminReleaseDevice, useDevices } from '../../api/queries';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SkeletonBlock } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { ProgressBar } from '../../components/ui/ProgressBar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableHeadRow,
  TableRow,
} from '../../components/ui/Table';
import { relativeTime } from '../../utils/time';
import { StatTile, StatTileGrid } from '../../components/ui/StatTile';
import { largestOf } from '../../utils/breakdown';

/**
 * The device registry, with an inventory strip above it (admin feature #2):
 * how many devices exist, how many are claimed, how many are still reporting,
 * and what firmware the fleet is actually running.
 */
export function AdminDevicesPage() {
  return (
    <div className="space-y-4">
      <DeviceInventoryStrip />
      <DeviceRegistry />
    </div>
  );
}

function DeviceInventoryStrip() {
  const inventoryQuery = useAdminDeviceInventory();

  if (inventoryQuery.isLoading) return <SkeletonBlock className="h-40" />;
  if (inventoryQuery.isError || !inventoryQuery.data) {
    return <Alert status="danger">Could not load device inventory — the registry below still works.</Alert>;
  }

  const inventory = inventoryQuery.data;
  const largest = largestOf(inventory.byModel.map((row) => row.count));

  return (
    <div className="space-y-3">
      <StatTileGrid>
        <StatTile size="lg" label="Devices" value={inventory.total.toLocaleString()} hint="Known to the platform" />
        <StatTile size="lg" label="Claimed" value={inventory.claimed.toLocaleString()} hint="Have an owner" />
        <StatTile size="lg" label="Unclaimed" value={inventory.unclaimed.toLocaleString()} />
        <StatTile size="lg"
          label="Reporting"
          value={inventory.reportingLastDay.toLocaleString()}
          hint="Seen in the last 24 h"
        />
      </StatTileGrid>

      <Card
        density="compact"
        header={<h2 className="text-h3 font-semibold text-ink-primary">Model &amp; firmware mix</h2>}
      >
        {inventory.byModel.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-muted">No devices registered yet.</p>
        ) : (
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Model</TableHeadCell>
                <TableHeadCell>Firmware</TableHeadCell>
                <TableHeadCell>Devices</TableHeadCell>
                <TableHeadCell>Share of the largest group</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {inventory.byModel.map((row) => (
                <TableRow key={`${row.model}-${row.fwVersion ?? 'unknown'}`}>
                  <TableCell>{row.model}</TableCell>
                  <TableCell muted mono>
                    {row.fwVersion ?? 'unknown'}
                  </TableCell>
                  <TableCell className="font-tabular">{row.count.toLocaleString()}</TableCell>
                  <TableCell>
                    <ProgressBar
                      value={row.count}
                      max={largest}
                      label={`${row.model} ${row.fwVersion ?? 'unknown'}: ${row.count} devices`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function DeviceRegistry() {
  const devicesQuery = useDevices();
  const releaseDevice = useAdminReleaseDevice();
  const editDevice = useAdminEditDevice();
  const [editingBdAddr, setEditingBdAddr] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [confirmingRelease, setConfirmingRelease] = useState<string | null>(null);

  const beginEdit = (bdAddr: string, model: string, label: string | null) => {
    setEditingBdAddr(bdAddr);
    setModelDraft(model);
    setLabelDraft(label ?? '');
  };

  return (
    <div className="space-y-3">
      {/* Mutation failures are surfaced, not swallowed (review FE-07) — the same
          isError treatment AdminUsersPage/AdminAuditPage/AdminRelationshipsPage use. */}
      {editDevice.isError && (
        <Alert status="danger" onDismiss={() => editDevice.reset()}>
          Could not save this device: {editDevice.error.message}
        </Alert>
      )}
      {releaseDevice.isError && (
        <Alert status="danger" onDismiss={() => releaseDevice.reset()}>
          Could not force-release this device: {releaseDevice.error.message}
        </Alert>
      )}

      {confirmingRelease && (
        <Alert status="danger" onDismiss={() => setConfirmingRelease(null)}>
          <div className="space-y-2">
            <p>
              Force-release <span className="font-mono">{confirmingRelease}</span> from its current owner? They will
              immediately lose access to this device's readings and history.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                loading={releaseDevice.isPending}
                onClick={() => {
                  // Dismiss on success only (review FE-07): closing the confirm
                  // unconditionally told the admin the device had been released
                  // whether or not the request succeeded.
                  releaseDevice.mutate(confirmingRelease, { onSuccess: () => setConfirmingRelease(null) });
                }}
              >
                Force-release device
              </Button>
              <Button variant="tertiary" size="sm" onClick={() => setConfirmingRelease(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <Table>
        <TableHead>
          <TableHeadRow>
            <TableHeadCell>BD Address</TableHeadCell>
            <TableHeadCell>Label</TableHeadCell>
            <TableHeadCell>Model</TableHeadCell>
            <TableHeadCell>Owner</TableHeadCell>
            <TableHeadCell>Last seen</TableHeadCell>
            <TableHeadCell>Claimed</TableHeadCell>
            <TableHeadCell />
          </TableHeadRow>
        </TableHead>
        <TableBody>
          {devicesQuery.data?.map((device) => (
            <TableRow key={device.bdAddr}>
              <TableCell mono>{device.bdAddr}</TableCell>
              <TableCell muted>{device.label ?? '—'}</TableCell>
              <TableCell>
                {editingBdAddr === device.bdAddr ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Input
                      className="!w-40"
                      aria-label="Label"
                      placeholder="Customer-facing name"
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                    />
                    <Input className="!w-32" aria-label="Model" value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} />
                    <Button
                      size="sm"
                      loading={editDevice.isPending && editDevice.variables?.bdAddr === device.bdAddr}
                      onClick={() => {
                        // Empty string clears the owner's label (backend trims to null).
                        // Editor closes on success only (review FE-07) — otherwise a
                        // rejected edit looked exactly like a saved one.
                        editDevice.mutate(
                          {
                            bdAddr: device.bdAddr,
                            edit: { model: modelDraft, label: labelDraft },
                          },
                          { onSuccess: () => setEditingBdAddr(null) },
                        );
                      }}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  device.model
                )}
              </TableCell>
              <TableCell muted>{device.ownerUsername ?? 'unclaimed'}</TableCell>
              <TableCell
                muted
                title={device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : undefined}
              >
                {device.lastSeenAt ? relativeTime(device.lastSeenAt) : '—'}
              </TableCell>
              <TableCell muted>{device.claimedAt ? new Date(device.claimedAt).toLocaleString() : '—'}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => beginEdit(device.bdAddr, device.model, device.label)}
                  >
                    Edit
                  </Button>
                  {device.ownerUsername && (
                    <Button variant="destructive" size="sm" onClick={() => setConfirmingRelease(device.bdAddr)}>
                      Force-release
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
