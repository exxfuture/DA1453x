import { describe, expect, it } from 'vitest';
import { decodeHtpTemperature, encodeHtpTemperature } from './ieee11073';

function dataViewOf(buffer: ArrayBuffer): DataView {
  return new DataView(buffer);
}

describe('decodeHtpTemperature', () => {
  it('decodes the standard IEEE-11073 encoding (exponent=-2) at 0.01°C resolution', () => {
    // 27.15 °C == mantissa 2715 * 10^-2 — the default firmware encoding.
    const buffer = encodeHtpTemperature(2715, -2);
    expect(decodeHtpTemperature(dataViewOf(buffer), false)).toBeCloseTo(27.15, 4);
  });

  it('decodes negative temperatures correctly', () => {
    // -5.30 °C == mantissa -530 * 10^-2
    const buffer = encodeHtpTemperature(-530, -2);
    expect(decodeHtpTemperature(dataViewOf(buffer), false)).toBeCloseTo(-5.3, 4);
  });

  it('decodes zero degrees correctly', () => {
    const buffer = encodeHtpTemperature(0, -2);
    expect(decodeHtpTemperature(dataViewOf(buffer), false)).toBeCloseTo(0, 4);
  });

  it('does NOT ignore the exponent the way the vendor SmartBond app incorrectly does', () => {
    // The bug this test guards against: reading the raw mantissa (2715) as
    // degrees directly, instead of applying the -2 exponent to get 27.15.
    const buffer = encodeHtpTemperature(2715, -2);
    const decoded = decodeHtpTemperature(dataViewOf(buffer), false);
    expect(decoded).not.toBe(2715);
    expect(decoded).toBeCloseTo(27.15, 4);
  });

  it('handles CFG_TEMP_RAW_CELSIUS firmware mode (exponent=0, integer °C) when rawCelsiusMode is enabled', () => {
    const buffer = encodeHtpTemperature(27, 0);
    expect(decodeHtpTemperature(dataViewOf(buffer), true)).toBe(27);
  });

  it('returns null for a characteristic value shorter than 5 bytes', () => {
    const shortBuffer = new ArrayBuffer(3);
    expect(decodeHtpTemperature(dataViewOf(shortBuffer), false)).toBeNull();
  });

  it('round-trips a range of realistic body/ambient temperatures', () => {
    const cases: Array<[number, number]> = [
      [3650, -2], // 36.50 °C
      [3720, -2], // 37.20 °C — mild fever
      [4010, -2], // 40.10 °C — high fever
      [-4000, -2], // -40.00 °C — sensor spec floor
      [8500, -2], // 85.00 °C — sensor spec ceiling
    ];
    for (const [mantissa, exponent] of cases) {
      const buffer = encodeHtpTemperature(mantissa, exponent);
      const expected = mantissa * Math.pow(10, exponent);
      expect(decodeHtpTemperature(dataViewOf(buffer), false)).toBeCloseTo(expected, 4);
    }
  });
});
