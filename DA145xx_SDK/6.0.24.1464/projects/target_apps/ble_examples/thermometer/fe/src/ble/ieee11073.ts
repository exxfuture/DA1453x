/**
 * IEEE-11073-20601 FLOAT decode for the Bluetooth Health Thermometer
 * Profile's Temperature Measurement characteristic (0x2A1C).
 *
 * Ported, framework-agnostic (architecture v3 §3.4 migration plan), from the
 * Angular FE's `app.component.ts` — kept byte-for-byte identical to avoid
 * regressing the exponent decode the vendor's own SmartBond app gets wrong
 * (see ../../../README.md, "Temperature encoding").
 *
 * Byte layout of the characteristic value:
 *   [0]    flags  (bit 0: 0=Celsius, bit 2: Temperature Type present)
 *   [1..4] IEEE-11073 FLOAT, little-endian
 *            bits[31:24] = signed exponent (int8)
 *            bits[23: 0] = signed mantissa (int24)
 */

/**
 * Mantissa values IEEE-11073-20601 §A.1 reserves for "this is not a
 * measurement" (review FE-04). They are ordinary-looking 24-bit patterns, so
 * without this check a sensor fault decodes to a plausible finite temperature —
 * 0x7FFFFF at exponent -2 comes out as 83886.07 °C, which nothing downstream
 * filters (`trendInsight.ts` only drops non-finite values) and which would then
 * render as "High Fever", stretch the chart's Y domain and skew trend averages.
 *
 * Detected BEFORE the two's-complement conversion, since that is what turns
 * 0x800000 and 0x800002 into negative numbers indistinguishable from real
 * sub-zero readings.
 */
const RESERVED_MANTISSAS = new Set([
  0x7fffff, // NaN — value could not be represented
  0x800000, // NRes — not at this resolution
  0x7ffffe, // +INFINITY — above the sensor's range
  0x800002, // -INFINITY — below the sensor's range
]);

/**
 * Returns the temperature in °C, or `null` when the value cannot be read as a
 * measurement: a short buffer, or one of the reserved sentinels above. `null`
 * is the established "no reading" contract here — every caller
 * (webBluetoothTransport, nativeBluetoothTransport, the simulator's tests)
 * already drops it rather than publishing.
 */
export function decodeHtpTemperature(value: DataView, rawCelsiusMode: boolean): number | null {
  if (!value || value.byteLength < 5) {
    return null;
  }

  const rawFloat = value.getUint32(1, /* littleEndian */ true);

  // Decode signed 24-bit mantissa from the lower 3 bytes
  const mantRaw = rawFloat & 0x00ffffff;
  if (RESERVED_MANTISSAS.has(mantRaw)) {
    return null;
  }
  const mantissa = mantRaw >= 0x800000 ? mantRaw - 0x1000000 : mantRaw;

  if (rawCelsiusMode) {
    // Firmware built with CFG_TEMP_RAW_CELSIUS: exponent=0, mantissa=integer °C.
    return mantissa;
  }

  // Standard IEEE-11073: exponent=-2, mantissa=temp×100. Apply the exponent
  // for 0.01 °C resolution.
  const expByte = (rawFloat >>> 24) & 0xff;
  const exponent = expByte >= 128 ? expByte - 256 : expByte;
  return mantissa * Math.pow(10, exponent);
}

/**
 * Inverse of {@link decodeHtpTemperature} — builds a synthetic HTP
 * characteristic value. Used by tests and by the device simulator tooling
 * (see ../../../tools/) to produce realistic payloads without real hardware.
 */
export function encodeHtpTemperature(mantissa: number, exponent: number): ArrayBuffer {
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, 0); // flags: Celsius, no temperature-type field
  const mantissaBits = mantissa < 0 ? mantissa + 0x1000000 : mantissa;
  const exponentBits = exponent < 0 ? exponent + 256 : exponent;
  const rawFloat = ((exponentBits & 0xff) << 24) | (mantissaBits & 0x00ffffff);
  view.setUint32(1, rawFloat >>> 0, true);
  return buffer;
}
