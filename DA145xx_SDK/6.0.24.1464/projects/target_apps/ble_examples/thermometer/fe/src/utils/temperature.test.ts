import { describe, expect, it } from 'vitest';
import { convertFromCelsius, unitSuffix } from './temperature';

describe('convertFromCelsius', () => {
  it('passes Celsius through unchanged', () => {
    expect(convertFromCelsius(37, 'CELSIUS')).toBe(37);
  });

  it('converts to Fahrenheit', () => {
    expect(convertFromCelsius(0, 'FAHRENHEIT')).toBe(32);
    expect(convertFromCelsius(100, 'FAHRENHEIT')).toBe(212);
    expect(convertFromCelsius(37, 'FAHRENHEIT')).toBeCloseTo(98.6, 5);
  });
});

describe('unitSuffix', () => {
  it('returns the correct glyph per unit', () => {
    expect(unitSuffix('CELSIUS')).toBe('°C');
    expect(unitSuffix('FAHRENHEIT')).toBe('°F');
  });
});
