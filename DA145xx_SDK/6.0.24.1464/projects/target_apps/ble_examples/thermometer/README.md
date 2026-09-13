# BLE Thermometer — DA14535-00FXDEVKT-U

A BLE Health Thermometer Profile (HTP) application for the Renesas DA14535-00FXDEVKT-U development kit.
Reads temperature and humidity from an AHT20 sensor over I2C and transmits temperature measurements to a BLE collector via HTP indications.

This README covers the **firmware**. The rest of the system — backend, web
app, mobile app, and an optional headless gateway — is documented in
`ARCHITECTURE_V3.html` and implemented in the folders below.

---

## Platform (backend, web, mobile, gateway)

An implementation of architecture v3 (`ARCHITECTURE_V3.html`): a Java/Spring
Boot backend ingesting measurements over MQTT into TimescaleDB, a React web
app that connects to the device over Web Bluetooth, a Capacitor mobile
wrapper of that same app for Android/iOS, and an optional Go gateway binary
for unattended sites. Everything is dockerized and runnable locally without
real hardware (a synthetic device simulator stands in for the BLE thermometer).

### Quick start

```bash
docker compose up --build
```

If you have a **pre-existing** local stack (a `postgres_data` volume from
before 2026-08-07): the backend's schema migrations were consolidated into a
single `V1__init.sql` (pre-prod, no versioning discipline yet — see
`backend/README.md` "Data model"), which Flyway will reject against an old
volume's migration history as a checksum mismatch. Reset it once with
`docker compose down -v` before bringing the stack back up; this drops local
dev data only.

This starts Mosquitto, PostgreSQL+TimescaleDB, Keycloak (with a demo realm
pre-imported, styled to match the web app — see `deploy/README.md`), MinIO,
the backend, the web app, and a **fleet of four**
simulated "devices" (`gateway-1`..`gateway-4` in `--simulate` mode,
`AA:BB:CC:DD:EE:01`..`04`, each publishing synthetic readings every 5s — no
physical thermometer needed). Each self-registers as unclaimed the moment it
starts publishing, so all four show up in the web app's Devices page within
a few seconds.

| Service | URL | Notes |
|---------|-----|-------|
| Web app | http://localhost:8090 | React + Vite; Web Bluetooth needs Chrome/Edge |
| Backend API | http://localhost:8080 | `/actuator/health` is open; the rest of `/actuator/**` needs an **admin** JWT, everything else any Keycloak JWT. The two OTA collector endpoints take an `X-Device-Token` header instead of a JWT — see `backend/README.md` "Device & operator authentication" |
| Keycloak admin | http://localhost:8082 | `admin` / `admin` |
| Mailpit (local email catcher) | http://localhost:8025 | Catches Keycloak's password-reset emails — see "Demo accounts" below |
| MinIO console | http://localhost:9091 | `thermometer` / `thermometer123` |
| Postgres | localhost:5433 | `thermometer` / `thermometer` (host port 5433 — 5432 often taken by a local Postgres; containers use the internal network) |
| Mosquitto | localhost:1883 (MQTT), localhost:9001 (WebSocket) | anonymous access — local dev only |

Sign in at the web app with "Sign in with Keycloak" — this redirects to
Keycloak's own hosted login page (standard OAuth2 Authorization Code + PKCE,
`fe/src/auth/oidc.ts`), not a form owned by this app. Password change and
"Forgot password?" are both handled the same way, by Keycloak itself — see
`fe/README.md`'s implementation-status table.

**Demo accounts** (`deploy/keycloak/realm-export.json`; passwords satisfy the
realm's password policy — length ≥ 8, upper/lower/digit/special char — so
they aren't simply "password = username").
See `backend/README.md` "Roles & identity" for the full permission model —
briefly: a customer can claim any number of devices from the fleet, name each one so pickers and legends show the name instead of the Bluetooth address, and can
grant doctors access to their data; a doctor sees only consenting patients;
admin sees and can edit everything but never claims a device itself.

| Username | Password | Role | Can do |
|----------|----------|------|--------|
| `customer1` | `Customer1!` | customer | Claim one or more devices from the fleet; scroll/zoom the history chart; compare several devices on one chart; export CSV; see fever-episode history and a trend digest; annotate individual readings; set personal alert thresholds; grant/revoke doctor access and review that consent history; edit own profile (display name, preferred °C/°F unit); change own password |
| `customer2` | `Customer2!` | customer | Same as `customer1` |
| `doctor1` | `Doctor1!` | doctor | For every customer who's granted consent: a risk-ranked patient worklist with variability and staleness, a fleet-wide fever-episode feed, per-patient charts and multi-patient compare, per-patient alert-threshold overrides, private care notes, a printable clinical report, and their own audit trail |
| `admin1` | `Admin123!` | admin | View/edit all users (search, filter, local-registry role correction), all devices (incl. force-release) with inventory stats, all doctor-patient relationships with integrity warnings, plus ingest health, OTA rollout progress, the audit log with a security-anomaly view, storage/retention insight, and the system-default alert thresholds |

Prove a simulated device's readings are flowing end to end (needs a Keycloak
token — see `deploy/README.md`):

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/measurements/AA:BB:CC:DD:EE:01?type=temperature"
```

Or publish a one-off reading by hand instead of waiting for the simulator:
`tools/simulate-device.sh`.

### Components

| Folder | What it is | Docs |
|--------|------------|------|
| `backend/` | Spring Boot 3 / Java 21 ingest + REST API | `backend/README.md` |
| `fe/` | React + TypeScript + Vite web app (Web Bluetooth) | `fe/README.md` |
| `mobile/` | Capacitor wrapper of `fe/` for Android/iOS | `mobile/README.md` |
| `gateway/` | Optional Go binary for headless/unattended collection | `gateway/README.md` |
| `deploy/` | Mosquitto/Keycloak config consumed by `docker-compose.yml` | `deploy/README.md` |
| `tools/` | `simulate-device.sh` — publish a one-off fake reading | — |

Each folder's README has its own **Build / Run / Test** sections and an
explicit **"what's implemented vs. scaffolded"** table — this is a working
MVP-scope implementation of architecture v3's Phase 1, not the full
million-device system; read those tables before assuming a given capability
is live.

Building and testing each component independently (without Docker, for
faster iteration):

```bash
cd backend && mvn test              # unit tests, ~1s
cd backend && mvn verify            # + Testcontainers integration tests (needs Docker)
cd fe       && npm test             # vitest — pins the IEEE-11073 decode correctness
cd gateway  && go test ./...
```

For a full real-browser, real-backend end-to-end check (needs the whole
stack running — `docker compose up -d` first): `cd fe && npm run test:e2e`.
It logs in, connects a simulated device (no hardware needed — see
`fe/README.md` "Testing without real hardware"), claims it, and confirms the
reading round-trips through the live feed onto the dashboard chart — plus a
second scenario covering device-fleet claiming, doctor consent, and the
doctor/admin views.

---

## Hardware

### Development kit

Renesas **DA14535-00FXDEVKT-U** (Pro development kit, USB dongle form factor).

### AHT20 sensor wiring

| AHT20 pin | DA14535 devkit connection | Notes |
|-----------|--------------------------|-------|
| VDD | J3 pin 1 — 3.3 V | 100 nF decoupling cap recommended near VDD |
| GND | J3 pin 2 — GND | |
| SCL | J3 — **P0_7** | **4.7 kΩ pull-up to 3.3 V required** |
| SDA | J3 — **P0_6** | **4.7 kΩ pull-up to 3.3 V required** |

The AHT20 I2C address is fixed at **0x38** — no address-select pin.

> **Note:** P0_6 and P0_7 are used for I2C on DA14535 builds. On DA14531 hardware
> P0_6 is also UART2_TX, which may conflict with the DIP switch configuration on the
> DA14531-00FXDEVKT-U devkit. These pins are safe on DA14535.
>
> P0_1 and P0_2 are the SWD_DATA / SWD_CLK debug pins — do not connect them to I2C
> as it disables the debug interface while firmware is running.

### On-board peripherals used

| Signal | Pin | Description |
|--------|-----|-------------|
| User LED | P0_9 | 50 ms flash every 2 s while advertising (2.5 % duty to save battery); solid on when connected |
| User Button | P0_11 | Disconnects current peer and restarts advertising |

---

## Building

### Prerequisites

- **ARM GNU Toolchain 11.3** installed at `/Applications/ArmGNUToolchain/11.3.rel1/arm-none-eabi/`
  (adjust the `PATH` line in `build.sh` if installed elsewhere)

### Command-line (standalone GCC build)

```bash
# from the thermometer/ directory:
bash build.sh          # development build (CFG_DEVELOPMENT_DEBUG enabled)
bash build.sh release  # production build (-DCFG_PRODUCTION, debug features off)
bash build.sh clean    # remove all build output
```

Output files are placed in `build/DA14535/` (development) or
`build/DA14535-release/` (production):

| File | Description |
|------|-------------|
| `thermometer.elf` | ELF binary (for debuggers) |
| `thermometer.hex` | Intel HEX (flash this file) |
| `thermometer.map` | Linker map |

Builds are **incremental**: unchanged sources are skipped using GCC `.d`
dependency files, and a change to the compile flags forces a full rebuild
automatically. Each build also regenerates `compile_commands.json` at the
project root so clangd/IDE diagnostics work correctly.

### Host-side unit tests

The pure codec logic (AHT20 CRC-8 and frame decode, IEEE 11073 encoding,
sample aggregation) lives in `src/codec.h` and is tested on the host:

```bash
bash tests/run_tests.sh
```

A GitHub Actions workflow (`.github/workflows/firmware.yml` at the repo root)
runs the tests plus both firmware builds on every push touching this project.

---

## Flashing

Use **SmartSnippets Toolbox** or **J-Link Commander**.

### SmartSnippets Toolbox

1. Open SmartSnippets Toolbox.
2. Select **DA14535** as the target device.
3. Go to **JTAG/SWD → Burn to RAM** (for testing) or **Burn to Flash** (permanent).
4. Browse to `build/DA14535/thermometer.hex`.
5. Click **Flash**.

### J-Link (CLI)

```bash
JLinkExe -device DA14535 -if SWD -speed 4000 -autoconnect 1
J-Link> loadfile build/DA14535/thermometer.hex
J-Link> r
J-Link> g
```

---

## Bluetooth operation

### Advertising

After power-on the device advertises as **`DLG_THRM`** with the Health Thermometer Service UUID (0x1809) in the advertising payload. Advertising interval is **687.5 ms**.

- LED flashes 50 ms every 2 s during advertising.
- Advertising stops after **1 minute** (`user_default_hnd_conf.advertise_period`) if no connection is made.
- After timeout, the LED is turned off and the device enters **deep sleep** with all RAM blocks powered off. A press of the user button (P0_11, armed via the wakeup controller) or a power-cycle reboots the device, which then starts advertising again automatically.

### Connection

- LED turns solid on when a collector connects.
- Temperature measurements begin when the collector **enables HTP indications** (writes `0x0002` to the Temperature Measurement CCCD, UUID 0x2A1C).
- Default measurement interval: **5 seconds** (configurable at runtime via the Measurement Interval characteristic, range 1–300 s).
- Each measurement cycle takes up to **3 samples 100 ms apart** and sends the **median** (mean of 2 / single value if some samples fail), after adding the `CFG_TEMP_OFFSET_X100` calibration offset.
- BLE connection parameters: interval **90–110 ms with slave latency 4** (effective radio wakeup ≈ 550 ms worst case, supervision timeout 3 s) — an order of magnitude fewer radio wakeups than a low-latency link, at no cost for readings that are seconds apart.
- The **Device Information Service** exposes the model (`DA14535`), software revision (application firmware version), and firmware revision (SDK version).
- Press the user button to **disconnect** and return to advertising mode.

### Disconnection

- LED turns off.
- Advertising restarts automatically.

### Edge-case behavior

- **First power-up / uncalibrated sensor:** if the AHT20 reports "not
  calibrated", the first measurement cycle sends the one-time init command
  instead of a trigger and is skipped — the first temperature arrives one
  interval later than usual.
- **Sensor absent, I2C error, sensor still busy, or CRC mismatch:** failed
  samples within a cycle are simply dropped (the median/mean uses the valid
  ones); a cycle with zero valid samples is skipped silently. The BLE link,
  button, and LED are unaffected. No error is reported over BLE.
- **Automatic sensor recovery:** after **5 consecutive dead cycles** the
  firmware soft-resets the AHT20 (command 0xBA) in place of that cycle's
  measurement; after **10**, it first performs a manual I2C bus recovery
  (clocking SCL up to 9 times to release a slave stuck holding SDA, then a
  STOP condition) before the soft reset. The ladder repeats every 5 further
  failures until the sensor answers again.
- **Collector disables indications** (writes `0x0000` to the CCCD): the
  measurement timer stops immediately; re-enabling restarts it.
- **Out-of-range interval write** (outside 1–300 s): rejected with the HTP
  "Out of Range" error; the current interval is kept.
- **Humidity** is read from the AHT20 but not transmitted — the HTP
  Temperature Measurement characteristic carries temperature only.
- **No bonding persistence:** pairing (Just Works) is supported, but the bond
  database callbacks are not implemented, so nothing survives a disconnect —
  the collector must re-enable indications on every new connection.

---

## Sleep and power management

The device uses **Extended Sleep** (`ARCH_EXT_SLEEP_ON`) while advertising and during connections, so the CPU sleeps between every BLE event. After the advertising timeout it switches to **deep sleep** (all RAM off, pads latched, LED off) and only a button press or power-cycle — both causing a full reboot — brings it back.

### What wakes the CPU

| Event | Wake source |
|-------|-------------|
| BLE advertising slot | BLE timer |
| BLE connection event | BLE timer |
| Temperature timer callback | Kernel timer (`app_easy_timer`) |
| AHT20 conversion wait | Kernel timer (`app_easy_timer`) |
| I2C transfer complete | I2C interrupt |
| User button press | GPIO wakeup interrupt |

### Between measurements

During the interval between measurements (default 5 s) the CPU is in extended sleep. It wakes **only** for scheduled BLE connection events to maintain the link. No polling occurs.

### During a measurement cycle

A cycle takes up to 3 samples ~100 ms apart (≈ 500 ms end-to-end); each
sample is:

```
~0 ms    Trigger: I2C sends 3-byte command to AHT20            → CPU returns to sleep
~90 ms   Read:    I2C reads 7-byte result (data + CRC), driver
                  validates the AHT20 CRC-8 before decoding    → CPU returns to sleep
```

After the last sample the median (3 valid) / mean (2) / single value plus the
`CFG_TEMP_OFFSET_X100` calibration offset is queued as one HTP indication.
Samples that fail (CRC mismatch, busy, I2C error) are dropped from the
aggregate; a cycle with zero valid samples is skipped and counted toward the
sensor-recovery ladder (see Edge-case behavior).

The I2C peripheral is initialised immediately before each phase and released immediately after — it is never held while the CPU is sleeping.

### RAM retention during sleep

Two RAM blocks are retained during extended sleep:
- **Block 1** (`CFG_RETAIN_RAM_1_BLOCK`): application state, BLE stack data.
- **Non-retained heap** is automatically retained if it contains live messages (`CFG_AUTO_DETECT_NON_RET_HEAP`).

### Low-power clock

The internal **RCX20** oscillator (`LP_CLK_RCX20`) is used as the low-power clock — no external 32 kHz crystal is required. Drift is configured at **500 ppm** (`CFG_NVDS_TAG_LPCLK_DRIFT`).

### Transmit power

TX power is set to **0 dBm** (`CFG_TX_POWER_LEVEL` in `src/thermometer.h`,
applied in `periph_init()`) instead of the +2.5 dBm maximum — ample link
margin for bedside range at lower radio current. Comment the define out to
restore the SDK default (maximum).

---

## Temperature encoding

The temperature value inside each HTP indication is an **IEEE 11073-20601 FLOAT** — a 4-byte little-endian value mandated by the Bluetooth Health Thermometer Profile.

```
Bytes [1..4] of the indication:
  bits[31:24]  signed 8-bit exponent
  bits[23: 0]  signed 24-bit mantissa

  displayed temperature = mantissa × 10^exponent
```

### Compile-time flag: `CFG_TEMP_RAW_CELSIUS`  *(in `src/thermometer.h`)*

| Flag state | Exponent | Mantissa | Resolution | SmartBond app | Angular FE app |
|------------|----------|----------|------------|---------------|----------------|
| **Not defined** (default) | −2 | temp × 100 | **0.01 °C** | Shows `temp×100` (e.g. `2715`) — incorrect | Decodes correctly → `27.15 °C` ✅ |
| **Defined** | 0 | integer °C | 1 °C | Shows integer directly → `27 °C` ✅ | Shows integer → `27 °C` |

The Renesas SmartBond iOS app ignores the exponent and renders the raw mantissa as degrees Celsius, which is incompatible with standard 0.01 °C IEEE 11073 encoding. It cannot display sub-degree precision correctly regardless of firmware settings.

**Recommendation:** leave `CFG_TEMP_RAW_CELSIUS` commented out and use the Angular FE web app for accurate 0.01 °C readings.

---

## Temperature measurement flow

All I2C operations are fully interrupt-driven (async). The CPU never spins waiting for the bus.

Each cycle runs the chain below up to `TEMP_SAMPLES_PER_MEASUREMENT` (3)
times, 100 ms apart (`sample_gap_cb`); `handle_sample_done()` collects the
samples and only the final aggregate is sent. If the failure-recovery ladder
is due, `temp_timer_cb` performs the AHT20 soft reset / bus recovery *instead
of* the chain for that cycle.

```
BLE event loop
  └─ temp_timer_cb  (fires every interval)
       └─ i2c_temp_sensor_trigger()  → returns immediately
            └─ on_trigger_done()  [I2C ISR]
                 └─ app_easy_timer(90 ms, aht20_read_cb)
                      └─ aht20_read_cb()  [BLE event loop]
                           └─ i2c_temp_sensor_read()  → returns immediately
                                └─ on_data_read()  [I2C ISR, driver — validates CRC-8]
                                     └─ on_read_done()  [I2C ISR, app]
                                          └─ handle_sample_done()  [I2C ISR]
                                               ├─ more samples due:
                                               │    app_easy_timer(100 ms, sample_gap_cb)
                                               │      └─ next trigger (chain repeats)
                                               └─ cycle complete: aggregate + offset,
                                                    app_easy_timer(1 tick, send_indication_cb)
                                                      └─ send_indication_cb()  [BLE event loop]
                                                           └─ app_htpt_send_measurement()
```

The 90 ms wait between trigger and read is the AHT20 conversion time (80 ms typical + 10 ms margin).

---

## Configuration reference

All user-facing configuration is in `src/thermometer.h`, `src/config/user_profiles_config.h`, `src/config/da14535_config_basic.h`, and `src/config/da14535_config_advanced.h`.

### Application — `src/thermometer.h`

| Define | Default | Description |
|--------|---------|-------------|
| `CFG_TEMP_RAW_CELSIUS` | *(undefined)* | Temperature encoding mode — see [Temperature encoding](#temperature-encoding) |
| `TEMP_MEAS_INTERVAL_DEFAULT_SEC` | `5` | Default measurement interval in seconds at power-on |
| `TEMP_SAMPLES_PER_MEASUREMENT` | `3` | Samples per cycle: 3 → median, 2 → mean, 1 → raw single reading |
| `TEMP_SAMPLE_GAP_TICKS` | `10` | Gap between samples within a cycle (10 ms ticks; 10 = 100 ms) |
| `CFG_TEMP_OFFSET_X100` | `0` | Calibration offset added to every reported value, 0.01 °C units |
| `AHT20_FAILS_BEFORE_SOFT_RESET` | `5` | Consecutive dead cycles before an AHT20 soft reset |
| `AHT20_FAILS_BEFORE_BUS_RECOVERY` | `10` | Consecutive dead cycles before manual I2C bus recovery |
| `CFG_TX_POWER_LEVEL` | `RF_TX_PWR_LVL_0d0` | BLE TX power (0 dBm); comment out for SDK default (+2.5 dBm) |

### BLE profiles — `src/config/user_profiles_config.h`

| Define | Default | Description |
|--------|---------|-------------|
| `CFG_PRF_HTPT` | defined | Health Thermometer Profile (server) — required |
| `CFG_PRF_BASS` | defined | Battery Service (server) — reports battery level |
| `CFG_PRF_DISS` | defined | Device Information Service — model, SW revision (app version), FW revision (SDK version) |
| `APP_HTPT_MEAS_INTERVAL` | `5` | Default HTP measurement interval in seconds |
| `APP_HTPT_VALID_RANGE_MIN` | `1` | Minimum interval the collector may write (seconds) |
| `APP_HTPT_VALID_RANGE_MAX` | `300` | Maximum interval the collector may write (seconds) |
| `APP_BASS_POLL_INTERVAL` | `6000` | Battery level polling interval in 10 ms ticks (= 60 s) |

### Basic chip config — `src/config/da14535_config_basic.h`

| Define | Default | Description |
|--------|---------|-------------|
| `CFG_WDOG` | defined | Watchdog timer enabled |
| `CFG_WDG_TRIGGER_HW_RESET_IN_PRODUCTION_MODE` | *(undefined)* | Watchdog triggers NMI (not hard reset) at zero |
| `CFG_DEVELOPMENT_DEBUG` | defined unless `CFG_PRODUCTION` | Debug mode: OTP mirror emulation, GPIO reservation checks, breakpoints in fault handlers. Disabled automatically by `bash build.sh release`. |
| `CFG_PRINTF` | *(undefined)* | Enable UART console logging via `arch_printf()` |
| `CFG_PRINTF_UART2` | *(auto)* | Use UART2 for console output when `CFG_PRINTF` is defined |
| `CFG_MAX_CONNECTIONS` | `1` | Maximum concurrent BLE connections |
| `CFG_APP_SECURITY` | defined | BLE security / pairing support enabled |

### Advanced chip config — `src/config/da14535_config_advanced.h`

| Define | Default | Description |
|--------|---------|-------------|
| `CFG_LP_CLK` | `LP_CLK_RCX20` | Low-power clock source. `LP_CLK_RCX20` = internal RC oscillator (no external crystal needed). `LP_CLK_XTAL32` = external 32 kHz crystal (more accurate). |
| `CFG_NVDS_TAG_LPCLK_DRIFT` | `DRIFT_500PPM` | Low-power clock drift tolerance. RCX20 typically needs 500 ppm; XTAL32 can use 20–50 ppm for tighter timing. |
| `CFG_NVDS_TAG_BD_ADDRESS` | `{0x10,0x00,0xF4,0x35,0x23,0x48}` | Default Bluetooth device address. Overridden if a BD address is programmed in OTP. |
| `CFG_MAX_SLEEP_DURATION_EXTERNAL_WAKEUP_MS` | `600000` | Maximum sleep duration (ms) when waiting for external wakeup only — 600 s |
| `CFG_TRNG` | defined | True Random Number Generator enabled; seeds the PRNG at startup |
| `CFG_ENABLE_SMP_SECURE` | defined | BLE Secure Connections (ECDH) pairing supported |
| `CFG_USE_CHACHA20_RAND` | defined | ChaCha20 CSPRNG used instead of C stdlib `rand()` |
| `CFG_RET_DATA_SIZE` | `2200` | Retained RAM size in bytes (application + BLE stack state kept across sleep) |
| `CFG_AUTO_DETECT_NON_RET_HEAP` | defined | SDK automatically retains non-retained heap if it is non-empty at sleep entry |
| `CFG_RETAIN_RAM_1_BLOCK` | defined | RAM block 1 is always retained during extended sleep |
| `CFG_CODE_LOCATION_EXT` | defined | Firmware loaded from external SPI flash (not burned into OTP) |
| `CFG_AMB_TEMPERATURE` | defined | Hibernation mode temperature range: ambient (−40 to +40 °C). Change to `CFG_EXT_TEMPERATURE` for −40 to +85 °C operation. |

---

## AHT20 sensor specification

| Parameter | Value |
|-----------|-------|
| Temperature range | −40 to +85 °C |
| Temperature accuracy | ±0.3 °C |
| Humidity range | 0 to 100 % RH |
| Humidity accuracy | ±2 % RH |
| I2C address | 0x38 (fixed) |
| I2C speed | 400 kHz (Fast Mode) |
| Conversion time | 80 ms typical; 90 ms used |
| Data integrity | CRC-8 (poly 0x31, init 0xFF) over status + 5 data bytes; validated by the driver, bad samples discarded |

---

## Project structure

```
thermometer/
├── README.md                   This file — firmware docs + platform quick start
├── ARCHITECTURE_V3.html        Current system architecture: requirements, BLE
│                               collectors (mobile/web/gateway), self-hosted data
│                               platform, roles (customer/doctor/admin), OTA update
│                               pipeline — Java/Spring Boot backend, React web FE
├── ARCHITECTURE_V2.html        v2 architecture (superseded by ARCHITECTURE_V3.html,
│                               kept as the historical record of the cost/complexity review)
├── ARCHITECTURE.html           v1 architecture (superseded, kept as the historical
│                               record of the initial design)
├── PACKAGING_CONCEPT.md        Wearable product/packaging concept (enclosure,
│                               battery, sensor choice, baby safety, regulatory)
├── proposals.md                Improvement backlog with implementation status
│
├── docker-compose.yml          Runs the whole platform locally — see "Platform" above
├── deploy/                     Mosquitto + Keycloak config for docker-compose.yml
├── tools/simulate-device.sh    Publish a one-off fake reading without the gateway
├── backend/                    Spring Boot 3 / Java 21 ingest + REST API
├── fe/                         React + Vite web app (Web Bluetooth)
├── mobile/                     Capacitor wrapper of fe/ for Android/iOS
├── gateway/                    Optional Go headless-collector binary
│
├── build.sh                    Standalone GCC build script (dev/release, incremental)
├── compile_commands.json       Generated by build.sh for clangd (do not edit)
├── tests/
│   ├── test_codec.c            Host-side unit tests for src/codec.h
│   └── run_tests.sh            Build & run the tests with the host compiler
├── build/
│   ├── DA14535/                Development build output (generated)
│   │   ├── thermometer.elf
│   │   ├── thermometer.hex
│   │   └── thermometer.map
│   └── DA14535-release/        Production build output (generated)
└── src/
    ├── thermometer.c           Application logic and BLE state machine
    ├── thermometer.h           Application compile-time config (sampling, offset,
    │                           TX power, recovery thresholds, encoding mode)
    ├── codec.h                 Pure codec functions (CRC-8, AHT20 decode,
    │                           IEEE 11073 encode, aggregation) — host-testable
    ├── i2c_temp_sensor.c       AHT20 async interrupt-driven I2C driver + soft reset
    ├── i2c_temp_sensor.h       AHT20 driver API and constants (AHT20_CONVERSION_MS)
    ├── platform/
    │   └── user_periph_setup.c GPIO and peripheral initialisation
    └── config/
        ├── da14535_config_basic.h    Chip-level feature flags (watchdog, debug, UART)
        ├── da14535_config_advanced.h Low-power clock, sleep, RAM retention, BLE timing
        ├── da1458x_config_basic.h    Dispatcher — includes the correct chip variant header
        ├── da1458x_config_advanced.h Dispatcher — includes the correct chip variant header
        ├── user_callback_config.h    Maps BLE stack events to application callbacks
        ├── user_config.h             BLE advertising, GAP, security, sleep mode
        ├── user_modules_config.h     SDK module enable/disable switches
        ├── user_periph_setup.h       Pin definitions (I2C SCL/SDA, LED, button)
        └── user_profiles_config.h   HTP and BASS profile configuration and intervals
```
