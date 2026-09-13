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
    const characteristic = await service.getCharacteristic(TEMP_MEASUREMENT_UUID);

    characteristic.addEventListener('characteristicvaluechanged', this.handleValueChanged);
    await characteristic.startNotifications();

    return { id: this.device.id, name: this.device.name ?? 'DLG_THRM' };
  }

  disconnect(): void {
    if (this.server?.connected) {
      this.server.disconnect(); // triggers 'gattserverdisconnected' -> handleGattDisconnected
    }
    this.device?.removeEventListener('gattserverdisconnected', this.handleGattDisconnected);
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
