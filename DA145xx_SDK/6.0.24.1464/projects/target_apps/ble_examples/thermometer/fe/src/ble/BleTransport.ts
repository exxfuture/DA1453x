/**
 * Shared BLE abstraction (architecture v3 §3.3 / v1 §5.1): one interface,
 * two implementations — Web Bluetooth here for the browser, and the
 * @capacitor-community/bluetooth-le adapter in ../../../mobile for
 * Android/iOS. Everything above this interface (UI, upload, live view) is
 * identical on both platforms.
 */
export interface ConnectedDevice {
  /** Web Bluetooth does not expose the real BD address for privacy reasons;
   *  this is the browser-assigned device id, used only to key local UI
   *  state, NOT sent to the backend as the canonical device_id. */
  id: string;
  name: string;
}

export interface BleTransport {
  isSupported(): boolean;
  requestDevice(): Promise<ConnectedDevice>;
  disconnect(): void;
  onTemperature(callback: (celsius: number, ts: Date) => void): void;
  onDisconnected(callback: () => void): void;
}
