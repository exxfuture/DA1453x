import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceResponse } from '../../api/client';

/**
 * The admin device registry's mutation paths (review FE-07 / FE-11).
 *
 * The bug: `editDevice.mutate(...)` and `releaseDevice.mutate(...)` were each
 * followed unconditionally by the state change that closes the UI, so a rejected
 * request looked exactly like a successful one — an admin believed a device had
 * been edited or force-released when it had not. These tests fail the *failure*
 * path specifically, which no e2e scenario exercises.
 */

const device: DeviceResponse = {
  id: 'd1',
  bdAddr: 'AA:BB:CC:DD:EE:FF',
  model: 'DA14535',
  label: 'Ward 3 spare',
  fwVersion: '1.0.2',
  ownerUserId: 'u2',
  ownerUsername: 'customer2',
  claimedAt: '2026-09-01T10:00:00Z',
  createdAt: '2026-08-01T10:00:00Z',
  lastSeenAt: '2026-09-14T07:59:00Z',
  lastSeenType: 'temperature',
};

const listDevices = vi.fn(() => Promise.resolve([device]));
const adminDeviceInventory = vi.fn(() =>
  Promise.resolve({ total: 1, claimed: 1, unclaimed: 0, reportingLastDay: 1, byModel: [] }),
);
const adminEditDevice = vi.fn<(bdAddr: string, edit: unknown) => Promise<unknown>>();
const adminReleaseDevice = vi.fn<(bdAddr: string) => Promise<void>>();

vi.mock('../../api/client', () => ({
  api: {
    listDevices: () => listDevices(),
    adminDeviceInventory: () => adminDeviceInventory(),
    adminEditDevice: (bdAddr: string, edit: unknown) => adminEditDevice(bdAddr, edit),
    adminReleaseDevice: (bdAddr: string) => adminReleaseDevice(bdAddr),
  },
}));

const { AdminDevicesPage } = await import('./AdminDevicesPage');

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Waits for the registry row to be on screen before interacting with it. */
async function renderRegistry() {
  renderPage(<AdminDevicesPage />);
  await screen.findByText('AA:BB:CC:DD:EE:FF');
}

beforeEach(() => {
  adminEditDevice.mockReset();
  adminReleaseDevice.mockReset();
  adminEditDevice.mockResolvedValue(device);
  adminReleaseDevice.mockResolvedValue(undefined);
});

describe('AdminDevicesPage — edit', () => {
  it('closes the editor once the edit is persisted', async () => {
    await renderRegistry();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const labelField = screen.getByLabelText('Label');
    await userEvent.clear(labelField);
    await userEvent.type(labelField, 'Ward 4 spare');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(adminEditDevice).toHaveBeenCalledOnce());
    expect(adminEditDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', {
      model: 'DA14535',
      label: 'Ward 4 spare',
    });
    await waitFor(() => expect(screen.queryByLabelText('Label')).not.toBeInTheDocument());
  });

  it('keeps the editor open and shows the error when the edit fails (FE-07)', async () => {
    adminEditDevice.mockRejectedValue(new Error('Device is being provisioned'));
    await renderRegistry();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/Device is being provisioned/);
    // Still editable: the admin's unsaved change is not silently discarded, and
    // the row does not pretend the new value is in the database.
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
  });

  it('lets the admin dismiss the edit error and try again', async () => {
    adminEditDevice.mockRejectedValueOnce(new Error('Device is being provisioned'));
    await renderRegistry();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Device is being provisioned/);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(/Device is being provisioned/)).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('Label')).not.toBeInTheDocument());
  });
});

describe('AdminDevicesPage — force-release', () => {
  it('asks for confirmation before releasing', async () => {
    await renderRegistry();

    await userEvent.click(screen.getByRole('button', { name: 'Force-release' }));

    await screen.findByRole('button', { name: 'Force-release device' });
    expect(adminReleaseDevice).not.toHaveBeenCalled();
    // Cancelling must not release anything.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(adminReleaseDevice).not.toHaveBeenCalled();
  });

  it('closes the confirmation once the release is persisted', async () => {
    await renderRegistry();

    await userEvent.click(screen.getByRole('button', { name: 'Force-release' }));
    await userEvent.click(screen.getByRole('button', { name: 'Force-release device' }));

    await waitFor(() => expect(adminReleaseDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Force-release device' })).not.toBeInTheDocument(),
    );
  });

  it('keeps the confirmation open and shows the error when the release fails (FE-07)', async () => {
    adminReleaseDevice.mockRejectedValue(new Error('Device has an active rollout'));
    await renderRegistry();

    await userEvent.click(screen.getByRole('button', { name: 'Force-release' }));
    await userEvent.click(screen.getByRole('button', { name: 'Force-release device' }));

    await screen.findByText(/Device has an active rollout/);
    // The admin must not walk away believing the owner lost access.
    expect(screen.getByRole('button', { name: 'Force-release device' })).toBeInTheDocument();
  });
});
