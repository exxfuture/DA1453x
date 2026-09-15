import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Connect page's transport lifecycle (review FE-05 / FE-11).
 *
 * What is faked and why:
 *  - `api/client` — this is about the page's own behaviour, not HTTP;
 *  - `live/mqttClient` — the publish path is asserted by call count, and a real
 *    MQTT client would try to open a WebSocket;
 *  - `ble/createBleTransport` and the simulator — the test drives the transport's
 *    lifecycle directly, which is exactly what the bug was about.
 *
 * The `useThermometerStore` zustand store is REAL: the page's connect/disconnect
 * flow runs through it, and a fake would prove nothing about the real one.
 */

const uploadMeasurement = vi.fn((_envelope: unknown) => Promise.resolve());
const claimDevice = vi.fn((_bdAddr: string, _model?: string) => Promise.resolve({}));
const me = vi.fn(() =>
  Promise.resolve({
    id: 'local-user-1',
    username: 'customer1',
    email: null,
    role: 'customer' as const,
    displayName: null,
    temperatureUnit: 'CELSIUS' as const,
  }),
);

vi.mock('../api/client', () => ({
  api: {
    me: () => me(),
    uploadMeasurement: (envelope: unknown) => uploadMeasurement(envelope),
    claimDevice: (bdAddr: string, model?: string) => claimDevice(bdAddr, model),
  },
}));

const publishMeasurement = vi.fn((_envelope: unknown) => Promise.resolve());
const unsubscribeLive = vi.fn();
const subscribeLive = vi.fn((_listener: (measurement: unknown) => void) => unsubscribeLive);

vi.mock('../live/mqttClient', () => ({
  publishMeasurement: (envelope: unknown) => publishMeasurement(envelope),
  subscribeLive: (listener: (measurement: unknown) => void) => subscribeLive(listener),
  closeLiveSession: () => undefined,
}));

/** A BleTransport whose every lifecycle call is observable. */
class FakeTransport {
  disconnect = vi.fn();
  temperatureListener: ((celsius: number, ts: Date) => void) | null = null;
  disconnectedListener: (() => void) | null = null;
  requestDevice = vi.fn(() => Promise.resolve({ id: 'AA:BB:CC:DD:EE:FF', name: 'DLG_THRM (simulated)' }));
  isSupported = () => true;
  onTemperature = (callback: (celsius: number, ts: Date) => void) => {
    this.temperatureListener = callback;
  };
  onDisconnected = (callback: () => void) => {
    this.disconnectedListener = callback;
  };
}

let transport: FakeTransport;

vi.mock('../ble/createBleTransport', () => ({
  createBleTransport: () => transport,
}));
vi.mock('../ble/simulatedBluetoothTransport', () => ({
  SimulatedBluetoothTransport: class {
    constructor() {
      return transport;
    }
  },
}));

const { ConnectPage } = await import('./ConnectPage');
const { useThermometerStore } = await import('../state/store');

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Clicks "Connect (Simulated Device)" and waits for the connected panel. */
async function connect() {
  await userEvent.click(screen.getByRole('button', { name: 'Connect (Simulated Device)' }));
  await screen.findByText('DLG_THRM (simulated)');
}

beforeEach(() => {
  transport = new FakeTransport();
  publishMeasurement.mockClear();
  uploadMeasurement.mockClear();
  claimDevice.mockClear();
  subscribeLive.mockClear();
  unsubscribeLive.mockClear();
  // The store is module-level singleton state, like it is in the app.
  useThermometerStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectPage', () => {
  it('connects, shows the device and publishes each reading on both paths', async () => {
    renderWithQuery(<ConnectPage />);
    await connect();

    expect(transport.requestDevice).toHaveBeenCalledOnce();

    // Wrapped in act(): a BLE notification is an external event arriving
    // outside React's own event system, exactly as it does on real hardware.
    act(() => transport.temperatureListener?.(37.21, new Date()));

    await waitFor(() => expect(screen.getByText(/37\.21/)).toBeInTheDocument());
    // Primary MQTT publish plus the belt-and-braces REST upload.
    expect(publishMeasurement).toHaveBeenCalledOnce();
    expect(uploadMeasurement).toHaveBeenCalledOnce();
    expect(publishMeasurement.mock.calls[0][0]).toMatchObject({
      v: 1,
      device_id: 'AA:BB:CC:DD:EE:FF',
      collector_id: 'web-fe',
      type: 'temperature',
      payload: { celsius: 37.21 },
    });
  });

  it('disconnects the transport when the Disconnect button is used', async () => {
    renderWithQuery(<ConnectPage />);
    await connect();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(transport.disconnect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText('DLG_THRM (simulated)')).not.toBeInTheDocument());
  });

  it('disconnects the transport on unmount (FE-05)', async () => {
    // The regression: navigating away via any in-app link unmounted this page
    // and left the transport running — the simulator's interval kept publishing
    // to MQTT and REST forever, and a real device kept its GATT link and
    // notification stream open.
    const { unmount } = renderWithQuery(<ConnectPage />);
    await connect();
    expect(transport.disconnect).not.toHaveBeenCalled();

    unmount();

    expect(transport.disconnect).toHaveBeenCalledOnce();
  });

  it('does not disconnect twice when the user disconnects and then navigates away', async () => {
    const { unmount } = renderWithQuery(<ConnectPage />);
    await connect();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    unmount();

    // handleDisconnect clears the ref, so the unmount cleanup finds nothing —
    // a second disconnect() on a torn-down transport is exactly the kind of
    // call a real Web Bluetooth implementation can throw on.
    expect(transport.disconnect).toHaveBeenCalledOnce();
  });

  it('unmounts cleanly when nothing was ever connected', () => {
    const { unmount } = renderWithQuery(<ConnectPage />);
    expect(() => unmount()).not.toThrow();
    expect(transport.disconnect).not.toHaveBeenCalled();
  });

  it('subscribes to the live feed once signed in and unsubscribes on unmount', async () => {
    const { unmount } = renderWithQuery(<ConnectPage />);

    await waitFor(() => expect(subscribeLive).toHaveBeenCalled());
    // No user id is passed any more (FE-03): the topic comes from the
    // server-minted credential, so there is nothing for a caller to get wrong.
    expect(subscribeLive.mock.calls[0]).toHaveLength(1);

    unmount();
    expect(unsubscribeLive).toHaveBeenCalledOnce();
  });

  it('renders live events keyed by their own identity, newest first (FE-28)', async () => {
    renderWithQuery(<ConnectPage />);
    await waitFor(() => expect(subscribeLive).toHaveBeenCalled());

    const emit = subscribeLive.mock.calls[0][0];
    const event = (ts: string, celsius: number) => ({
      v: 1,
      device_id: 'AA:BB:CC:DD:EE:FF',
      collector_id: 'web-fe',
      ts,
      type: 'temperature',
      payload: { celsius },
    });

    act(() => {
      emit(event('2026-09-14T08:00:00.000Z', 36.5));
      emit(event('2026-09-14T08:00:05.000Z', 36.6));
    });

    await waitFor(() => expect(screen.queryByText('No live events yet.')).not.toBeInTheDocument());
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Prepended, so the newest reading is first.
    expect(items[0].textContent).toContain('36.6');
  });

  it('claims the connected device without inventing a model (FE-14)', async () => {
    renderWithQuery(<ConnectPage />);
    await connect();

    await userEvent.click(screen.getByRole('button', { name: /Claim this device/ }));

    await waitFor(() => expect(claimDevice).toHaveBeenCalledOnce());
    expect(claimDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', undefined);
  });

  it('expires the "Claimed ✓" confirmation instead of latching it forever (FE-29)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWithQuery(<ConnectPage />);
    await user.click(screen.getByRole('button', { name: 'Connect (Simulated Device)' }));
    await screen.findByText('DLG_THRM (simulated)');
    await user.click(screen.getByRole('button', { name: /Claim this device/ }));

    await screen.findByText('Claimed ✓');

    // TanStack Query's isSuccess stays true until the next mutate() or unmount,
    // so without the transient flag this badge never went away.
    await vi.advanceTimersByTimeAsync(9000);
    await waitFor(() => expect(screen.queryByText('Claimed ✓')).not.toBeInTheDocument());
  });

  it('shows an error and stays disconnected when pairing fails', async () => {
    transport.requestDevice.mockRejectedValueOnce(new Error('User cancelled the requestDevice() chooser.'));
    renderWithQuery(<ConnectPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Connect (Simulated Device)' }));

    await screen.findByText(/User cancelled/);
    expect(screen.queryByText('DLG_THRM (simulated)')).not.toBeInTheDocument();
  });

  it('survives a failed MQTT publish, still uploading over REST', async () => {
    publishMeasurement.mockRejectedValueOnce(new Error('broker unreachable'));
    renderWithQuery(<ConnectPage />);
    await connect();

    act(() => transport.temperatureListener?.(38.4, new Date()));

    await waitFor(() => expect(uploadMeasurement).toHaveBeenCalledOnce());
    // The rejection is handled, not left floating — an unhandled rejection here
    // would fail the whole suite.
    await waitFor(() => expect(screen.getByText(/38\.40/)).toBeInTheDocument());
  });
});
