import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceResponse } from '../api/client';

/**
 * The customer dashboard's query behaviour (review FE-10 / FE-11).
 *
 * The bug: `useMeasurementHistory` carries `refetchInterval: 5000` and was called
 * unconditionally, while compare mode hides everything it feeds AND starts its own
 * set of 5 s queries via `useMeasurementHistories` — two overlapping polling sets
 * for as long as the overlay stayed open, one of them feeding nothing visible.
 *
 * Asserted by counting `measurementHistory` calls per device across a few timer
 * ticks, which is the only way to see a refetch that shouldn't be happening.
 */

function device(bdAddr: string, label: string): DeviceResponse {
  return {
    id: bdAddr,
    bdAddr,
    model: 'DA14535',
    label,
    fwVersion: '1.0.2',
    ownerUserId: 'u1',
    ownerUsername: 'customer1',
    claimedAt: '2026-09-01T10:00:00Z',
    createdAt: '2026-08-01T10:00:00Z',
    lastSeenAt: '2026-09-14T07:59:00Z',
    lastSeenType: 'temperature',
  };
}

const DEVICES = [device('AA:BB:CC:DD:EE:01', 'Upstairs'), device('AA:BB:CC:DD:EE:02', 'Downstairs')];

const measurementHistory = vi.fn((bdAddr: string) =>
  Promise.resolve([
    { ts: '2026-09-14T08:00:00Z', deviceId: bdAddr, type: 'temperature', valueNum: 36.7, payload: '{}', collectorId: 'web-fe' },
    { ts: '2026-09-14T07:59:55Z', deviceId: bdAddr, type: 'temperature', valueNum: 36.8, payload: '{}', collectorId: 'web-fe' },
  ]),
);

vi.mock('../api/client', () => ({
  api: {
    me: () =>
      Promise.resolve({
        id: 'local-user-1',
        username: 'customer1',
        email: null,
        role: 'customer' as const,
        displayName: null,
        temperatureUnit: 'CELSIUS' as const,
      }),
    listDevices: () => Promise.resolve(DEVICES),
    measurementHistory: (bdAddr: string) => measurementHistory(bdAddr),
    listAnnotations: () => Promise.resolve([]),
    // Read by the OnboardingChecklist this page renders.
    consents: () => Promise.resolve([]),
  },
}));

const { DashboardPage } = await import('./DashboardPage');
const { useUiPreferences } = await import('../state/uiStore');

function renderDashboard(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** How many times each device's history was fetched. */
function callsFor(bdAddr: string): number {
  return measurementHistory.mock.calls.filter(([addr]) => addr === bdAddr).length;
}

beforeEach(() => {
  measurementHistory.mockClear();
  // The remembered-device preference is persisted zustand state shared across
  // tests; pin it so the dashboard always opens on the same device.
  useUiPreferences.getState().setLastDeviceBdAddr('AA:BB:CC:DD:EE:01');
});

describe('DashboardPage', () => {
  it('opens on the remembered device and charts its history', async () => {
    renderDashboard(<DashboardPage />);

    await waitFor(() => expect(callsFor('AA:BB:CC:DD:EE:01')).toBeGreaterThan(0));
    expect(callsFor('AA:BB:CC:DD:EE:02')).toBe(0);
    expect(await screen.findByRole('combobox', { name: 'Device' })).toHaveValue('AA:BB:CC:DD:EE:01');
  });

  it('switches device from the picker', async () => {
    renderDashboard(<DashboardPage />);
    const picker = await screen.findByRole('combobox', { name: 'Device' });

    await userEvent.selectOptions(picker, 'AA:BB:CC:DD:EE:02');

    await waitFor(() => expect(callsFor('AA:BB:CC:DD:EE:02')).toBeGreaterThan(0));
  });

  it('stops polling the single-device history while compare mode is open (FE-10)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDashboard(<DashboardPage />);

      await waitFor(() => expect(callsFor('AA:BB:CC:DD:EE:01')).toBeGreaterThan(0));

      await user.click(await screen.findByRole('button', { name: /Compare devices/ }));
      // Compare mode seeds itself with the device already on screen plus the next.
      await waitFor(() => expect(callsFor('AA:BB:CC:DD:EE:02')).toBeGreaterThan(0));

      // Drop the previously-selected device from the overlay, so device 01 is no
      // longer fetched by anything the user can see. Its single-device query —
      // which the picker still points at — is the only thing that could keep
      // polling it, and that is precisely the query FE-10 is about.
      await user.click(screen.getByRole('checkbox', { name: 'Upstairs' }));
      const singleBefore = callsFor('AA:BB:CC:DD:EE:01');
      const overlayBefore = callsFor('AA:BB:CC:DD:EE:02');

      // Three 5 s refetch windows.
      await vi.advanceTimersByTimeAsync(16_000);

      // The overlay's query keeps polling — that is what is on screen...
      expect(callsFor('AA:BB:CC:DD:EE:02')).toBeGreaterThan(overlayBefore);
      // ...and the hidden single-device query does not poll at all.
      expect(callsFor('AA:BB:CC:DD:EE:01')).toBe(singleBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes polling the single-device history when compare mode is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDashboard(<DashboardPage />);
      await waitFor(() => expect(callsFor('AA:BB:CC:DD:EE:01')).toBeGreaterThan(0));

      await user.click(await screen.findByRole('button', { name: /Compare devices/ }));
      await user.click(await screen.findByRole('button', { name: /Single device/ }));

      const resumedFrom = callsFor('AA:BB:CC:DD:EE:01');
      await vi.advanceTimersByTimeAsync(11_000);
      expect(callsFor('AA:BB:CC:DD:EE:01')).toBeGreaterThan(resumedFrom);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the overlay at the palette-derived maximum (FE-30)', async () => {
    const { MAX_OVERLAY_SERIES } = await import('../theme/chartColors');
    renderDashboard(<DashboardPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Compare devices/ }));

    // The legend states the cap, and it comes from the palette rather than a
    // literal declared twice under two names.
    expect(await screen.findByText(`Devices to overlay (up to ${MAX_OVERLAY_SERIES})`)).toBeInTheDocument();
    expect(MAX_OVERLAY_SERIES).toBe(5);
  });
});
