import { BleTransport, ConnectedDevice } from './BleTransport';

/**
 * Third implementation of {@link BleTransport}, alongside Web Bluetooth and
 * the Capacitor native plugin — generates synthetic readings instead of
 * talking to real hardware, so the entire app (connect → live reading →
 * upload → history) is exercisable with no physical thermometer and no
 * Web Bluetooth support at all. Mirrors the Go gateway's `--simulate` mode
 * (../../../gateway/internal/sensor/simulator.go) — same drift+noise shape,
 * same ~5s cadence as the firmware's default measurement interval.
 */
export class SimulatedBluetoothTransport implements BleTransport {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private temperatureCallback: ((celsius: number, ts: Date) => void) | null = null;
  private readonly baseline = 36.8;
  private readonly startedAt = Date.now();
  private readonly intervalMs: number;

  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs;
  }

  isSupported(): boolean {
    return true;
  }

  // Declared as returning a promise rather than `async`: there is genuinely
  // nothing to await here (no pairing dialog, no GATT handshake), and the
  // BleTransport interface is async because the *real* transports are.
  requestDevice(): Promise<ConnectedDevice> {
    // Shaped like a real BD address — unlike genuine Web Bluetooth (see the
    // note in webBluetoothTransport.ts), this simulator stands in for a
    // device reached the way a gateway or the mobile native plugin would,
    // both of which see the real MAC. A non-MAC-shaped id here would just
    // fail the backend's ClaimDeviceRequest validation for no good reason.
    const id = randomBdAddr();

    this.intervalId = setInterval(() => {
      this.temperatureCallback?.(this.nextReading(), new Date());
    }, this.intervalMs);

    // Emit an initial reading right away rather than waiting a full interval,
    // so the UI isn't sitting on "waiting for a reading…" for no reason.
    setTimeout(() => this.temperatureCallback?.(this.nextReading(), new Date()), 50);

    return Promise.resolve({ id, name: 'DLG_THRM (simulated)' });
  }

  disconnect(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onTemperature(callback: (celsius: number, ts: Date) => void): void {
    this.temperatureCallback = callback;
  }

  onDisconnected(_callback: () => void): void {
    // The simulator only ever stops via an explicit disconnect() call from
    // the UI — there's no "unexpected disconnect" to simulate, so unlike
    // the real transports there's nothing to invoke this callback with.
  }

  private nextReading(): number {
    const elapsedMinutes = (Date.now() - this.startedAt) / 60_000;
    const drift = 0.3 * Math.sin(elapsedMinutes / 10);
    const noise = (Math.random() - 0.5) * 0.1;
    return Math.round((this.baseline + drift + noise) * 100) / 100;
  }
}

function randomBdAddr(): string {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}
