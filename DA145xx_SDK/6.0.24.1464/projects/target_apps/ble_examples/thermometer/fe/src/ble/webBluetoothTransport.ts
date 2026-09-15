import { BleTransport, ConnectedDevice } from './BleTransport';
import { decodeHtpTemperature } from './ieee11073';

// Bluetooth SIG assigned names, resolved by the browser to their 16-bit UUIDs
const HT_SERVICE_UUID = 'health_thermometer'; // 0x1809
const TEMP_MEASUREMENT_UUID = 'temperature_measurement'; // 0x2A1C

/**
 * KNOWN GAP, not fixable from here: `BluetoothDevice.id` (used below as
 * `ConnectedDevice.id`, and from there as the wire envelope's `device_id`
 * and the claim request's `bdAddr`) is a browser-assigned opaque identifier,
 * NOT the device's real BD address — a deliberate Web Bluetooth privacy
 * restriction (see the MDN/spec docs), not an implementation shortcut here.
 * It also isn't stable across origins/profiles. Real hardware over Web
 * Bluetooth will therefore currently fail the backend's device-claim
 * validation (`ClaimDeviceRequest.bdAddr`'s colon-separated-MAC regex) — the
 * native mobile path (nativeBluetoothTransport.ts) and the gateway do get
 * the real MAC and don't have this problem. Untested here since it needs
 * real Web-Bluetooth-capable hardware to even reproduce; see
 * SimulatedBluetoothTransport for the one BLE path that IS fully testable
 * without hardware.
 */
export class WebBluetoothTransport implements BleTransport {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  /**
   * Held so `disconnect()` can detach the notification listener (review FE-06).
   *
   * Browsers cache `BluetoothRemoteGATTCharacteristic` objects per device, and
   * every reconnect in one page session creates a NEW transport instance — so a
   * listener left attached here stays attached to the cached characteristic and
   * keeps firing on the dead instance. One hardware notification then fans out
   * to every instance ever created, duplicating MQTT publishes and REST uploads.
   */
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private temperatureCallback: ((celsius: number, ts: Date) => void) | null = null;
  private disconnectedCallback: (() => void) | null = null;
  private rawCelsiusMode = false;

  private readonly handleValueChanged = (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    if (!value) return;
    const celsius = decodeHtpTemperature(value, this.rawCelsiusMode);
    if (celsius !== null) {
      this.temperatureCallback?.(celsius, new Date());
    }
  };

  private readonly handleGattDisconnected = () => {
    this.disconnectedCallback?.();
  };

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async requestDevice(): Promise<ConnectedDevice> {
    if (!this.isSupported()) {
      throw new Error('Web Bluetooth is not supported in this browser — use Chrome, Edge, or the mobile app.');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HT_SERVICE_UUID] }],
    });
    this.device.addEventListener('gattserverdisconnected', this.handleGattDisconnected);

    this.server = await this.device.gatt!.connect();
    const service = await this.server.getPrimaryService(HT_SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(TEMP_MEASUREMENT_UUID);

    this.characteristic.addEventListener('characteristicvaluechanged', this.handleValueChanged);
    await this.characteristic.startNotifications();

    return { id: this.device.id, name: this.device.name ?? 'DLG_THRM' };
  }

  disconnect(): void {
    // Both listeners come off, in the order that leaves nothing dangling if a
    // step throws: the characteristic's first (see the field's comment for why
    // a leaked one duplicates every reading), then the device's, then the GATT
    // link itself.
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.handleValueChanged);
    this.characteristic = null;

    this.device?.removeEventListener('gattserverdisconnected', this.handleGattDisconnected);
    if (this.server?.connected) {
      // The listener is already off, so this no longer calls back into
      // handleGattDisconnected — an explicit disconnect is not an "unexpected
      // disconnect" and the caller does its own teardown.
      this.server.disconnect();
    }
    this.device = null;
    this.server = null;
  }

  onTemperature(callback: (celsius: number, ts: Date) => void): void {
    this.temperatureCallback = callback;
  }

  onDisconnected(callback: () => void): void {
    this.disconnectedCallback = callback;
  }
}
