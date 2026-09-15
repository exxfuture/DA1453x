import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebBluetoothTransport } from './webBluetoothTransport';
import { encodeHtpTemperature } from './ieee11073';

/**
 * Listener-lifecycle regression tests for the Web Bluetooth transport
 * (review FE-06 / FE-11).
 *
 * Real Web Bluetooth needs hardware and a user gesture, so `navigator.bluetooth`
 * is faked — but the fakes are `EventTarget`s, which is the part that matters
 * here: the bug being pinned is a listener that is never removed, and only a
 * real event-dispatch mechanism can demonstrate that. Browsers cache
 * `BluetoothRemoteGATTCharacteristic` objects per device, so a leaked listener
 * on a discarded transport keeps firing and duplicates every MQTT publish and
 * REST upload.
 */

/** A characteristic that records how many listeners are currently attached. */
class FakeCharacteristic extends EventTarget {
  attached = 0;
  startNotifications = vi.fn(() => Promise.resolve(this));
  value: DataView | null = null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.attached += 1;
    super.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.attached -= 1;
    super.removeEventListener(type, listener);
  }

  /** Dispatches a notification the way the browser does, with `event.target` set. */
  notify(value: DataView): void {
    this.value = value;
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeDevice extends EventTarget {
  id = 'browser-assigned-id';
  name = 'DLG_THRM';
  attached = 0;
  readonly gatt: { connected: boolean; connect: () => Promise<unknown>; disconnect: () => void };

  constructor(readonly characteristic: FakeCharacteristic) {
    super();
    const server = {
      connected: true,
      connect: () => Promise.resolve(server),
      disconnect: () => {
        server.connected = false;
        this.dispatchEvent(new Event('gattserverdisconnected'));
      },
      getPrimaryService: () =>
        Promise.resolve({ getCharacteristic: () => Promise.resolve(characteristic) }),
    };
    this.gatt = server;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.attached += 1;
    super.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.attached -= 1;
    super.removeEventListener(type, listener);
  }
}

function installFakeBluetooth(device: FakeDevice): void {
  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: { requestDevice: vi.fn(() => Promise.resolve(device)) },
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'bluetooth');
});

describe('WebBluetoothTransport', () => {
  it('delivers decoded readings while connected', async () => {
    const characteristic = new FakeCharacteristic();
    installFakeBluetooth(new FakeDevice(characteristic));

    const transport = new WebBluetoothTransport();
    const onTemperature = vi.fn();
    transport.onTemperature(onTemperature);
    const device = await transport.requestDevice();

    expect(device).toEqual({ id: 'browser-assigned-id', name: 'DLG_THRM' });
    expect(characteristic.startNotifications).toHaveBeenCalledOnce();

    characteristic.notify(new DataView(encodeHtpTemperature(3712, -2)));
    expect(onTemperature).toHaveBeenCalledOnce();
    expect(onTemperature.mock.calls[0][0]).toBeCloseTo(37.12, 4);
  });

  it('drops a reserved IEEE-11073 sentinel instead of reporting it (FE-04 end to end)', async () => {
    const characteristic = new FakeCharacteristic();
    installFakeBluetooth(new FakeDevice(characteristic));

    const transport = new WebBluetoothTransport();
    const onTemperature = vi.fn();
    transport.onTemperature(onTemperature);
    await transport.requestDevice();

    characteristic.notify(new DataView(encodeHtpTemperature(0x7fffff, -2))); // NaN
    expect(onTemperature).not.toHaveBeenCalled();
  });

  it('removes the characteristic listener on disconnect (FE-06)', async () => {
    const characteristic = new FakeCharacteristic();
    installFakeBluetooth(new FakeDevice(characteristic));

    const transport = new WebBluetoothTransport();
    transport.onTemperature(vi.fn());
    await transport.requestDevice();
    expect(characteristic.attached).toBe(1);

    transport.disconnect();
    expect(characteristic.attached).toBe(0);
  });

  it('stops delivering readings from the cached characteristic after disconnect', async () => {
    // The actual FE-06 symptom: the browser hands the SAME characteristic object
    // back on reconnect, so a leaked listener on the old transport keeps firing
    // and one hardware notification publishes twice.
    const characteristic = new FakeCharacteristic();
    installFakeBluetooth(new FakeDevice(characteristic));

    const first = new WebBluetoothTransport();
    const firstReadings = vi.fn();
    first.onTemperature(firstReadings);
    await first.requestDevice();
    first.disconnect();

    const second = new WebBluetoothTransport();
    const secondReadings = vi.fn();
    second.onTemperature(secondReadings);
    await second.requestDevice();

    characteristic.notify(new DataView(encodeHtpTemperature(3700, -2)));

    expect(secondReadings).toHaveBeenCalledOnce();
    expect(firstReadings).not.toHaveBeenCalled();
    expect(characteristic.attached).toBe(1);
  });

  it('removes the device listener on disconnect too, and does not fire the disconnect callback', async () => {
    const characteristic = new FakeCharacteristic();
    const device = new FakeDevice(characteristic);
    installFakeBluetooth(device);

    const transport = new WebBluetoothTransport();
    const onDisconnected = vi.fn();
    transport.onDisconnected(onDisconnected);
    await transport.requestDevice();
    expect(device.attached).toBe(1);

    transport.disconnect();

    expect(device.attached).toBe(0);
    // An explicit disconnect() is not an "unexpected disconnect": the caller is
    // already tearing down, and a callback here would re-enter that teardown.
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('reports an unexpected GATT disconnect while connected', async () => {
    const characteristic = new FakeCharacteristic();
    const device = new FakeDevice(characteristic);
    installFakeBluetooth(device);

    const transport = new WebBluetoothTransport();
    const onDisconnected = vi.fn();
    transport.onDisconnected(onDisconnected);
    await transport.requestDevice();

    device.dispatchEvent(new Event('gattserverdisconnected'));
    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it('refuses to connect where Web Bluetooth is unavailable', async () => {
    const transport = new WebBluetoothTransport();
    expect(transport.isSupported()).toBe(false);
    await expect(transport.requestDevice()).rejects.toThrow(/not supported/i);
  });

  it('tolerates disconnect() before any connection', () => {
    expect(() => new WebBluetoothTransport().disconnect()).not.toThrow();
  });
});
