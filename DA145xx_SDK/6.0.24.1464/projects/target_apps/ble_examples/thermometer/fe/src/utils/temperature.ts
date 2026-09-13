import { TemperatureUnit } from '../api/client';

/** Readings are always stored/classified in Celsius — this is purely a display-time conversion. */
export function convertFromCelsius(celsius: number, unit: TemperatureUnit): number {
  return unit === 'FAHRENHEIT' ? (celsius * 9) / 5 + 32 : celsius;
}

export function unitSuffix(unit: TemperatureUnit): string {
  return unit === 'FAHRENHEIT' ? '°F' : '°C';
}
