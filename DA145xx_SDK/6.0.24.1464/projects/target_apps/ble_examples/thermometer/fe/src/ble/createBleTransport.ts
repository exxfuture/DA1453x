import { Capacitor } from '@capacitor/core';
import { BleTransport } from './BleTransport';
import { WebBluetoothTransport } from './webBluetoothTransport';
import { NativeBluetoothTransport } from './nativeBluetoothTransport';

/**
 * The one place the codebase branches between web and native BLE — this is
 * what makes "one codebase → web + Android + iOS" (architecture v3 §3.3)
 * true in practice. Everywhere else (pages, state, upload, live feed) is
 * unaware of which platform it's running on.
 */
export function createBleTransport(): BleTransport {
  return Capacitor.isNativePlatform() ? new NativeBluetoothTransport() : new WebBluetoothTransport();
}
