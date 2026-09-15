# BLE Thermometer — DA14535-00FXDEVKT-U

A BLE Health Thermometer Profile (HTP) application for the Renesas DA14535-00FXDEVKT-U development kit.
Reads temperature and humidity from an AHT20 sensor over I2C and transmits temperature measurements to a BLE collector via HTP indications.

This README covers the **firmware**. The rest of the system — backend, web
app, mobile app, and an optional headless gateway — is documented in
`ARCHITECTURE_V3.html` and implemented in the folders below. The prior
architecture revisions live in `docs/superseded/` as history only.

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

This is the **laptop profile**: every host port is bound to `127.0.0.1`,
every credential has a development default (override any of them from a
`.env` file — copy `.env.example`), the MQTT broker requires authentication,
all images are pinned, but traffic is plain HTTP. For anything reachable
beyond localhost layer the hardened overlay on top — it drops the host
ports, requires real secrets, and terminates TLS in a Caddy reverse proxy:

```bash
cp .env.example .env            # fill in every value
docker compose -f docker-compose.yml -f docker-compose.prod.yml config   # fails on any missing secret
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

See the header of `docker-compose.prod.yml` and `deploy/README.md` for what
the overlay changes (single public hostname, path-routed; Keycloak in
production mode without the demo realm; simulated gateways removed).

If you have a **pre-existing** local stack: a `postgres_data` volume from
before 2026-09-14 will be rejected by Flyway as a checksum mismatch (the
`V1__init.sql` header was rewritten in the code-review fix pass; the same
happened on 2026-08-07 when the migrations were consolidated — see
`backend/README.md` "Data model"), and a `mosquitto_data` volume from before
that date has no dynamic-security database yet. Reset both once with
`docker compose down -v` before bringing the stack back up; this drops local
dev data only (`flyway repair` is the data-preserving alternative for the
database).

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
| Web app | http://localhost:8090 | React + Vite served by an unprivileged nginx; Web Bluetooth needs Chrome/Edge. The API / broker / Keycloak URLs are injected at container start (`fe/README.md` "Runtime configuration"), not baked into the image |
| Backend API | http://localhost:8080 | `/actuator/health` is open; the rest of `/actuator/**` needs an **admin** JWT, everything else any Keycloak JWT. The two OTA collector endpoints take an `X-Device-Token` header instead of a JWT — see `backend/README.md` "Device & operator authentication" |
| Keycloak admin | http://localhost:8082 | `admin` / `admin` (`KC_BOOTSTRAP_ADMIN_*` in `.env`) |
| Mailpit (local email catcher) | http://localhost:8025 | Catches Keycloak's password-reset emails — see "Demo accounts" below |
| MinIO console | http://localhost:9091 | `thermometer` / `thermometer123` (`MINIO_ROOT_*` in `.env`) |
| Postgres | localhost:5433 | `thermometer` / `thermometer` (`POSTGRES_PASSWORD` in `.env`; host port 5433 — 5432 often taken by a local Postgres; containers use the internal network, and the backend's `local` profile points at 5433 too) |
| Mosquitto | localhost:1883 (MQTT), localhost:9001 (WebSocket) | **Authenticated** (dynamic-security plugin, no anonymous access). The backend connects as the broker admin (`MQTT_ADMIN_*`), gateways as `collector` (`MQTT_COLLECTOR_PASSWORD`), and the web app with a per-user credential it mints from the backend (`POST /api/live/credentials`) — see `deploy/README.md` for the identity/ACL table |

All of the above listen on `127.0.0.1` only.

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
| `admin1` | `Admin01!` | admin | View/edit all users (search, filter, local-registry role correction), all devices (incl. force-release) with inventory stats, all doctor-patient relationships with integrity warnings, plus ingest health, OTA rollout progress, the audit log with a security-anomaly view, storage/retention insight, and the system-default alert thresholds |

Prove a simulated device's readings are flowing end to end (needs a Keycloak
token — see `deploy/README.md`):

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/measurements/AA:BB:CC:DD:EE:01?type=temperature"
```

Or publish a one-off reading by hand instead of waiting for the simulator:
`tools/simulate-device.sh` (authenticates to the broker as the `collector`
client).

### Components

| Folder | What it is | Docs |
|--------|------------|------|
| `backend/` | Spring Boot 3 / Java 21 ingest + REST API | `backend/README.md` |
| `fe/` | React + TypeScript + Vite web app (Web Bluetooth) | `fe/README.md` |
| `mobile/` | Capacitor wrapper of `fe/` for Android/iOS | `mobile/README.md` |
| `gateway/` | Optional Go binary for headless/unattended collection | `gateway/README.md` |
| `deploy/` | Mosquitto / Keycloak / Caddy / Postgres-init config consumed by `docker-compose.yml` and `docker-compose.prod.yml` | `deploy/README.md` |
| `schema/` | `measurement-envelope.v1.schema.json` — the single source of truth for the MQTT wire envelope; the Go, Java and TypeScript implementations each validate against it in their tests | header of the schema file |
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
cd backend && mvn verify            # + Testcontainers integration tests (needs Docker; the broker container runs with the same dynamic-security setup as compose)
cd fe       && npm run lint         # tsc + ESLint (react-hooks, jsx-a11y)
cd fe       && npm test             # vitest — pure modules + component tests; pins the IEEE-11073 decode incl. the NaN/NRes/±Inf sentinels
cd gateway  && go vet ./... && go test ./...
```

All four (plus the firmware) run in CI on every push touching their folder
(`.github/workflows/*.yml`, actions pinned to commit SHAs).

For a full real-browser, real-backend end-to-end check (needs the whole
stack running — `docker compose up -d` first): `cd fe && npm run test:e2e`.
It logs in, connects a simulated device (no hardware needed — see
`fe/README.md` "Testing without real hardware"), claims it, and confirms the
reading round-trips through the live feed onto the dashboard chart — plus a
second scenario covering device-fleet claiming, doctor consent, and the
doctor/admin views, and two Keycloak password flows. Last run in full on
2026-09-14 (code-review fix pass, `proposals.md` §12) against a stack started
from empty volumes: 4 of 4 scenarios pass, with the broker authenticated and
the web app minting its own MQTT credential.

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

### Bluetooth device address — per-unit OTP provisioning is mandatory

The firmware's `CFG_NVDS_TAG_BD_ADDRESS` (`{0x10,0x00,0xF4,0x35,0x23,0x48}`)
is only a **fallback** used when the OTP header carries no address, and it is
the same value the SDK examples and the superseded `temp_reporter` use. Two
units running with the fallback advertise the same address, which confuses
collectors' scan filters and the platform's device registry (`devices.bd_addr`
is unique). Programming a unique address into the OTP header is therefore a
mandatory production step for every unit (SmartSnippets Toolbox → OTP
Header → BD address, or the Renesas Flash Programmer CLI — see
`PACKAGING_CONCEPT.md` §8); the fallback is acceptable only for a single
development kit on a bench.

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

### Eclipse (alternative, IDE-only)

`Eclipse/` holds a GNU MCU Eclipse project (`.cproject` / `.project`,
`makefile.targets`) with `DA14535`, `DA14535_01`, `DA14585` and `DA14586`
build configurations, wired to the same `src/` tree and the same
`src/config/da1458x_config_*.h` dispatchers (which is why the `da14531_*` /
`da14585_*` config variants exist next to the `da14535_*` ones that
`build.sh` uses). Import it into Eclipse with the SDK's GNU MCU plug-ins and
build a configuration from the IDE; Eclipse regenerates the per-configuration
build directories (`Eclipse/DA14535/`, `Eclipse/DA14585/`, …), which are
therefore git-ignored — they embed machine-local absolute paths and are not
a source of truth.

Support level: **DA14535 via `build.sh` is the supported, CI-built and
hardware-tested target.** The DA14585 configuration is kept compiling (every
chip-specific SDK call is guarded, e.g. the one- vs four-argument
`arch_set_deep_sleep()`), and that is verified by compiling the application
sources against the DA14585 SDK headers; it is not built in CI, not linked
into a tested image, and has never been flashed. Treat it as a porting
starting point, not a release target.

### Host-side unit tests

The pure logic in `src/codec.h` — AHT20 CRC-8 and frame decode, IEEE 11073
encoding, sample aggregation, offset saturation, and the measurement-cycle
decision table (`cycle_next_action()` / `recovery_action()`) that
`thermometer.c`'s ISR/task state machine is driven by — is tested on the
host:

```bash
bash tests/run_tests.sh
```

A GitHub Actions workflow (`.github/workflows/firmware.yml` at the repo root)
runs the tests plus both firmware builds on every push touching this project.
The platform components have their own workflows next to it
(`backend.yml`, `frontend.yml`, `gateway.yml`, `mobile.yml`), all path-filtered
the same way.

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
- The thermometer immediately sends a **security request**: pairing is Just
  Works (no display, no keyboard) **without bonding**, so the link is
  encrypted before any data flows and nothing is stored on either side —
  every connection pairs afresh. The Health Thermometer service is created
  with `SRV_PERM_UNAUTH`: its characteristics (Temperature Measurement,
  Measurement Interval, Temperature Type) can only be read, written or
  subscribed to over an encrypted link; a collector that tries before pairing
  completes gets an ATT "insufficient encryption" error. Battery Level and
  Device Information stay readable in the clear. A passive sniffer therefore
  never sees plaintext temperatures. *Validated so far against the SDK's
  security flow only — the behaviour of each collector platform's automatic
  Just-Works handling (Chrome Web Bluetooth on macOS/Windows/Linux, Android,
  iOS) still has to be confirmed on hardware; see "Edge-case behavior".*
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
- **No bonding persistence:** pairing (Just Works) is requested on every
  connection and required for the HTP characteristics, but no keys are
  distributed for bonding and the bond database callbacks are not
  implemented, so nothing survives a disconnect — the collector re-pairs and
  must re-enable indications on every new connection. A collector that
  insists on encrypting with a previously stored key (i.e. one that bonded
  against a different firmware) will fail with "key missing" and has to
  forget the device first.
- **Indication not delivered:** the HTP stack reports every indication's
  outcome; failures are counted (`s_indication_failures`, visible in a
  debugger) and, with `CFG_PRINTF` enabled, printed via `arch_printf()`. No
  retry — the next measurement cycle sends a fresh value anyway.
- **Button pressed mid-measurement:** the wake-up ISR's peripheral
  re-initialisation skips the I2C pads while an AHT20 transfer is in flight
  (`i2c_temp_sensor_busy()`), so the transaction completes normally before
  the disconnect it triggers is processed.

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
of* the chain for that cycle. The two decisions — "another sample, dead
cycle, or send" after each attempt and "which recovery step, if any" at the
start of a cycle — are the pure functions `cycle_next_action()` and
`recovery_action()` in `src/codec.h`, covered by the host tests.

Everything the I2C interrupt context and the BLE task context share
(connection guards, sample buffer and counters, the ISR-armed timer handles)
is `volatile`, and the cycle is torn down — connection guards cleared first,
then all timers cancelled inside a critical section — so a late I2C
completion can never re-arm a timer that was just cancelled.

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
| `TEMP_SAMPLES_PER_MEASUREMENT` | `3` | Samples per cycle: 3 → median, 2 → mean, 1 → raw single reading (1..3, enforced by `_Static_assert`) |
| `TEMP_SAMPLE_GAP_TICKS` | `10` | Gap between samples within a cycle (10 ms ticks; 10 = 100 ms) |
| `CFG_TEMP_OFFSET_X100` | `0` | Calibration offset added to every reported value, 0.01 °C units |
| `AHT20_FAILS_BEFORE_SOFT_RESET` | `5` | Consecutive dead cycles before an AHT20 soft reset (must be > 0, enforced by `_Static_assert`) |
| `AHT20_FAILS_BEFORE_BUS_RECOVERY` | `10` | Consecutive dead cycles before manual I2C bus recovery (must be a multiple of the soft-reset threshold, enforced by `_Static_assert`) |
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
| `CFG_NVDS_TAG_BD_ADDRESS` | `{0x10,0x00,0xF4,0x35,0x23,0x48}` | **Fallback** Bluetooth device address, used only if no address is programmed in the OTP header. Shared with the SDK examples — every production unit must get its own address in OTP (see "Bluetooth device address" under Hardware). |
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
├── DESIGN_SYSTEM.md            "Pine & Ember" design system: fonts, type scale,
│                               colour/spacing/radius/shadow tokens, component kit,
│                               Keycloak login-theme parity
├── DESIGN_SYSTEM.html          The same system as a self-contained visual reference
│                               (live swatches, specimens, light/dark toggle) — kept
│                               in sync with the .md by hand
├── PACKAGING_CONCEPT.md        Wearable product/packaging concept (enclosure,
│                               battery, sensor choice, baby safety, regulatory,
│                               per-unit OTP provisioning)
├── proposals.md                Improvement backlog with implementation status
├── CODE_REVIEW.html            Whole-project code review (2026-09-14): 92 verified
│                               findings across firmware, backend, fe, gateway,
│                               deploy and repo hygiene, filterable by severity/area,
│                               each with its resolution status after the fix pass
├── docs/superseded/            ARCHITECTURE.html (v1) and ARCHITECTURE_V2.html (v2):
│                               historical record only, superseded by ARCHITECTURE_V3.html
│
├── docker-compose.yml          Runs the whole platform locally (laptop profile) — see "Platform" above
├── docker-compose.prod.yml     Hardened overlay: no host ports, secrets from .env, Caddy TLS
├── .env.example                Every variable the two compose files read
├── deploy/                     Mosquitto (dynamic security), Keycloak realm + theme,
│                               Caddyfile, Postgres init — see deploy/README.md
├── schema/                     measurement-envelope.v1.schema.json — the wire-envelope
│                               contract all three collectors/ingest test against
├── tools/simulate-device.sh    Publish a one-off fake reading without the gateway
├── backend/                    Spring Boot 3 / Java 21 ingest + REST API
├── fe/                         React + Vite web app (Web Bluetooth)
├── mobile/                     Capacitor wrapper of fe/ for Android/iOS
├── gateway/                    Optional Go headless-collector binary
│
├── .gitignore                  build/, Eclipse per-config dirs, compile_commands.json,
│                               tests/test_codec, editor/OS noise
├── build.sh                    Standalone GCC build script (dev/release, incremental)
├── compile_commands.json       Generated by build.sh for clangd (git-ignored)
├── Eclipse/                    GNU MCU Eclipse project (.cproject/.project/.settings,
│                               makefile.targets) with DA14535/DA14535_01/DA14585/DA14586
│                               configurations — see "Eclipse (alternative, IDE-only)";
│                               the per-configuration build dirs are git-ignored
├── tests/
│   ├── test_codec.c            Host-side unit tests for src/codec.h (codec + cycle
│   │                           decision table)
│   └── run_tests.sh            Build & run the tests with the host compiler
├── build/                      Generated by build.sh (git-ignored)
│   ├── DA14535/                Development build output
│   │   ├── thermometer.elf
│   │   ├── thermometer.hex
│   │   └── thermometer.map
│   └── DA14535-release/        Production build output
└── src/
    ├── thermometer.c           Application logic and BLE state machine
    ├── thermometer.h           Application compile-time config (sampling, offset,
    │                           TX power, recovery thresholds, encoding mode) with
    │                           _Static_asserts guarding the tuning constants
    ├── codec.h                 Pure functions (CRC-8, AHT20 decode, IEEE 11073
    │                           encode, aggregation, cycle_next_action /
    │                           recovery_action decision table) — host-testable
    ├── i2c_temp_sensor.c       AHT20 async interrupt-driven I2C driver + soft reset
    ├── i2c_temp_sensor.h       AHT20 driver API and constants (AHT20_I2C_ADDRESS,
    │                           AHT20_CONVERSION_MS, i2c_temp_sensor_busy())
    ├── platform/
    │   └── user_periph_setup.c GPIO and peripheral initialisation, I2C bus recovery
    └── config/
        ├── da14535_config_basic.h    Chip-level feature flags (watchdog, debug, UART)
        ├── da14535_config_advanced.h Low-power clock, sleep, RAM retention, BLE timing
        ├── da14531_config_*.h        DA14531 variants of the two above (Eclipse configs)
        ├── da14585_config_*.h        DA14585/586 variants of the two above (Eclipse configs)
        ├── da1458x_config_basic.h    Dispatcher — includes the correct chip variant header
        ├── da1458x_config_advanced.h Dispatcher — includes the correct chip variant header
        ├── user_callback_config.h    Maps BLE stack events to application callbacks
        ├── user_config.h             BLE advertising, GAP, security (security request on
        │                             connect, placeholder-IRK guard), sleep mode
        ├── user_modules_config.h     SDK module enable/disable switches
        ├── user_periph_setup.h       Pin definitions (I2C SCL/SDA + bus parameters, LED, button)
        └── user_profiles_config.h   HTP and BASS profile configuration and intervals
```
