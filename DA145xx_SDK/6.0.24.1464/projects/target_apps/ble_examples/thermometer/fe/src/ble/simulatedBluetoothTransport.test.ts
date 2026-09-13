import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedBluetoothTransport } from './simulatedBluetoothTransport';

describe('SimulatedBluetoothTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is always reported as supported', () => {
    expect(new SimulatedBluetoothTransport().isSupported()).toBe(true);
  });

  it('resolves requestDevice with a BD-address-shaped id and a name', async () => {
    // Shaped like a real MAC on purpose — see the comment in
    // simulatedBluetoothTransport.ts — so it passes the same backend
    // validation (ClaimDeviceRequest) a real device's BD address would.
    const transport = new SimulatedBluetoothTransport();
    const device = await transport.requestDevice();

    expect(device.id).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
    expect(device.name).toContain('simulated');
  });

  it('emits a first reading shortly after connecting, without waiting a full interval', async () => {
    const transport = new SimulatedBluetoothTransport(5000);
    const readings: number[] = [];
    transport.onTemperature((celsius) => readings.push(celsius));

    await transport.requestDevice();
    await vi.advanceTimersByTimeAsync(100);

    expect(readings).toHaveLength(1);
  });

  it('emits plausible body/ambient temperatures on every interval tick', async () => {
    const transport = new SimulatedBluetoothTransport(1000);
    const readings: number[] = [];
    transport.onTemperature((celsius) => readings.push(celsius));

    await transport.requestDevice();
    await vi.advanceTimersByTimeAsync(5100); // initial + 5 interval ticks

    expect(readings.length).toBeGreaterThanOrEqual(5);
    for (const celsius of readings) {
      expect(celsius).toBeGreaterThan(35);
      expect(celsius).toBeLessThan(39);
    }
  });

  it('stops emitting readings after disconnect', async () => {
    const transport = new SimulatedBluetoothTransport(1000);
    const readings: number[] = [];
    transport.onTemperature((celsius) => readings.push(celsius));

    await transport.requestDevice();
    await vi.advanceTimersByTimeAsync(100);
    const countAtDisconnect = readings.length;

    transport.disconnect();
    await vi.advanceTimersByTimeAsync(5000);

    expect(readings.length).toBe(countAtDisconnect);
  });
});
