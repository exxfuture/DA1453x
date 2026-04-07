import { Component, NgZone, OnDestroy } from '@angular/core';
import { DecimalPipe } from '@angular/common';

// Health Thermometer Profile UUIDs (Bluetooth SIG assigned)
const HT_SERVICE_UUID         = 'health_thermometer'; // 0x1809
const TEMP_MEASUREMENT_UUID   = 'temperature_measurement'; // 0x2A1C

const LS_KEY_RAW_CELSIUS = 'thermometer_raw_celsius';

type Status = 'idle' | 'connecting' | 'connected' | 'error';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnDestroy {
  status: Status = 'idle';
  temperature: number | null = null;
  errorMessage = '';

  /**
   * When true, the mantissa of the IEEE-11073 FLOAT is used directly as °C
   * (exponent ignored).  This matches firmware built with CFG_TEMP_RAW_CELSIUS.
   *
   * When false, the full IEEE-11073 decode is applied:
   *   temperature = mantissa × 10^exponent
   * This is standards-compliant and works with firmware that sends exponent = -2.
   */
  rawCelsiusMode: boolean;

  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;

  // Bound handler references so we can remove the listeners cleanly.
  private readonly onValueChanged = (event: Event) => this.handleTemperature(event);
  private readonly onDisconnected = ()               => this.zone.run(() => this.handleDisconnect());

  constructor(private zone: NgZone) {
    this.rawCelsiusMode = localStorage.getItem(LS_KEY_RAW_CELSIUS) === 'true';
  }

  get bluetoothSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  toggleRawCelsius(): void {
    this.rawCelsiusMode = !this.rawCelsiusMode;
    localStorage.setItem(LS_KEY_RAW_CELSIUS, String(this.rawCelsiusMode));
    // Re-decode is not needed — the next indication will use the updated mode.
    this.temperature = null;
  }

  async connect(): Promise<void> {
    this.status       = 'connecting';
    this.temperature  = null;
    this.errorMessage = '';

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HT_SERVICE_UUID] }],
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected);

      this.server = await this.device.gatt!.connect();

      const service        = await this.server.getPrimaryService(HT_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(TEMP_MEASUREMENT_UUID);

      characteristic.addEventListener('characteristicvaluechanged', this.onValueChanged);
      await characteristic.startNotifications();

      this.zone.run(() => { this.status = 'connected'; });
    } catch (err: unknown) {
      this.zone.run(() => {
        this.status       = 'error';
        this.errorMessage = err instanceof Error ? err.message : String(err);
        this.cleanup();
      });
    }
  }

  disconnect(): void {
    if (this.server?.connected) {
      this.server.disconnect(); // triggers 'gattserverdisconnected'
    }
  }

  private handleDisconnect(): void {
    this.cleanup();
    this.status      = 'idle';
    this.temperature = null;
  }

  private cleanup(): void {
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.device = null;
    this.server = null;
  }

  /**
   * Parse an HTP Temperature Measurement characteristic value (0x2A1C).
   *
   * Byte layout:
   *   [0]    flags  (bit 0: 0=Celsius, bit 2: Temperature Type present)
   *   [1..4] IEEE-11073 FLOAT, little-endian
   *            bits[31:24] = signed exponent (int8)
   *            bits[23: 0] = signed mantissa (int24)
   *
   * rawCelsiusMode = false (default, IEEE-compliant):
   *   Temperature = mantissa × 10^exponent
   *
   * rawCelsiusMode = true (matches CFG_TEMP_RAW_CELSIUS firmware):
   *   Temperature = mantissa  (exponent is 0, mantissa is already integer °C)
   */
  private handleTemperature(event: Event): void {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value || value.byteLength < 5) return;

    const rawFloat = value.getUint32(1, /* littleEndian */ true);

    // Decode signed 24-bit mantissa from the lower 3 bytes
    const mantRaw  = rawFloat & 0x00FFFFFF;
    const mantissa = mantRaw >= 0x800000 ? mantRaw - 0x1000000 : mantRaw;

    let temperature: number;

    if (this.rawCelsiusMode) {
      // Firmware built with CFG_TEMP_RAW_CELSIUS: exponent=0, mantissa=integer °C.
      // SmartBond reads this correctly. The FE uses the mantissa directly.
      // Resolution: 1 °C.
      temperature = mantissa;
    } else {
      // Standard IEEE-11073: exponent=-2, mantissa=temp×100.
      // Apply the exponent for 0.01 °C resolution.
      const expByte  = (rawFloat >>> 24) & 0xFF;
      const exponent = expByte >= 128 ? expByte - 256 : expByte;
      temperature = mantissa * Math.pow(10, exponent);
    }

    this.zone.run(() => {
      this.temperature = temperature;
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
