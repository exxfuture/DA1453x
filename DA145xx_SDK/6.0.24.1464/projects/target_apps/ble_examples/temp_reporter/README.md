# temp_reporter — superseded prototype

**Status: superseded. Do not develop further — the successor is the
`thermometer` project** (`../thermometer/`), which replaced this prototype
with a real sensor and production-shaped tooling.

This project was the first temperature-over-BLE experiment (September 2025):

- **Temperature is simulated**: a raw ADC reading on P0_6 is linearly mapped
  to a hardcoded 36–40 °C range (`adc_to_temperature()` in
  `src/user_tempr.c`) — there is no actual temperature sensor.
- **Battery level is simulated**: it decrements 1 % every 20 measurements.
- Reports over the Health Thermometer Profile while connected; device name
  `DLG_TEMPR`; target chip DA14531.
- `web/` contains a plain-JS Web Bluetooth test page for the `DLG_TEMPR`
  device (see `web/README.md`). It is **not** the thermometer project's
  frontend — that is the Angular app in `renesas/thermometer_fe/`.

Kept for reference only (HTPT profile usage, Web Bluetooth test harness,
Eclipse build for DA14531). Built via the Eclipse project in `Eclipse/`;
last known-good output: `Eclipse/DA14531/temp_reporter.hex`.
