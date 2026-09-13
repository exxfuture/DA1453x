import { BleClient, type BleDevice } from '@capacitor-community/bluetooth-le';
import { BleTransport, ConnectedDevice } from './BleTransport';
import { decodeHtpTemperature } from './ieee11073';

// Bluetooth SIG 16-bit UUIDs, expressed the way @capacitor-community/bluetooth-le expects
const HT_SERVICE_UUID = '00001809-0000-1000-8000-00805f9b34fb';
const TEMP_MEASUREMENT_UUID = '00002a1c-0000-1000-8000-00805f9b34fb';

/**
 * Native BLE implementation of the shared {@link BleTransport} interface
 * (architecture v3 §3.3), used inside the Capacitor shell on Android/iOS via
 * @capacitor-community/bluetooth-le. Selected at runtime by
 * ./createBleTransport — the rest of the app (UI, upload, live view) is
 * identical to the web build.
 */
export class NativeBluetoothTransport implements BleTransport {
  private connectedDevice: BleDevice | null = null;
  private temperatureCallback: ((celsius: number, ts: Date) => void) | null = null;
  private disconnectedCallback: (() => void) | null = null;
  private rawCelsiusMode = false;

  isSupported(): boolean {
    return true; // guarded by createBleTransport() checking Capacitor.isNativePlatform()
  }

  async requestDevice(): Promise<ConnectedDevice> {
    await BleClient.initialize();
    const device = await BleClient.requestDevice({ services: [HT_SERVICE_UUID] });
    this.connectedDevice = device;

    await BleClient.connect(device.deviceId, () => {
      this.disconnectedCallback?.();
    });

    await BleClient.startNotifications(
      device.deviceId,
      HT_SERVICE_UUID,
      TEMP_MEASUREMENT_UUID,
      (value: DataView) => {
        const celsius = decodeHtpTemperature(value, this.rawCelsiusMode);
        if (celsius !== null) {
          this.temperatureCallback?.(celsius, new Date());
        }
      },
    );

    return { id: device.deviceId, name: device.name ?? 'DLG_THRM' };
  }

  disconnect(): void {
    if (this.connectedDevice) {
      BleClient.disconnect(this.connectedDevice.deviceId).catch(() => {
        // already disconnected — nothing to clean up
      });
      this.connectedDevice = null;
    }
  }

  onTemperature(callback: (celsius: number, ts: Date) => void): void {
    this.temperatureCallback = callback;
  }

  onDisconnected(callback: () => void): void {
    this.disconnectedCallback = callback;
  }
}
