# BLE Thermometer — DA14535-00FXDEVKT-U

A BLE Health Thermometer Profile (HTP) application for the Renesas DA14535-00FXDEVKT-U development kit.
Reads temperature and humidity from an AHT20 sensor over I2C and transmits temperature measurements to a BLE collector via HTP indications.

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
| User LED | P0_9 | Blinks 1 s on / 1 s off while advertising; solid on when connected |
| User Button | P0_11 | Disconnects current peer and restarts advertising |

---

## Building

### Prerequisites

- **ARM GNU Toolchain 11.3** installed at `/Applications/ArmGNUToolchain/11.3.rel1/arm-none-eabi/`
  (adjust the `PATH` line in `build.sh` if installed elsewhere)

### Command-line (standalone GCC build)

```bash
# from the thermometer/ directory:
bash build.sh          # build
bash build.sh clean    # remove build output
```

Output files are placed in `build/DA14535/`:

| File | Description |
|------|-------------|
| `thermometer.elf` | ELF binary (for debuggers) |
| `thermometer.hex` | Intel HEX (flash this file) |
| `thermometer.map` | Linker map |

The script compiles all source files in parallel (one job per CPU core) and always performs a full rebuild — there is no incremental build.

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

- LED blinks 1 s on / 1 s off during advertising.
- Advertising stops after **3 minutes** if no connection is made.
- After timeout, the device enters extended sleep and waits for a button press or power-cycle to restart advertising.

### Connection

- LED turns solid on when a collector connects.
- Temperature measurements begin when the collector **enables HTP indications** (writes `0x0002` to the Temperature Measurement CCCD, UUID 0x2A1C).
- Default measurement interval: **5 seconds** (configurable at runtime via the Measurement Interval characteristic, range 1–60 s).
- BLE connection interval: **10–20 ms**.
- Press the user button to **disconnect** and return to advertising mode.

### Disconnection

- LED turns off.
- Advertising restarts automatically.

---

## Sleep and power management

The device uses **Extended Sleep** (`ARCH_EXT_SLEEP_ON`) at all times — including during connections. The main loop callback returns `GOTO_SLEEP` unconditionally, so the CPU sleeps between every BLE event.

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

A measurement takes approximately 91 ms end-to-end:

```
~0 ms    Trigger: I2C sends 3-byte command to AHT20  → CPU returns to sleep
~90 ms   Read:    I2C reads 6-byte result from AHT20 → CPU returns to sleep
~91 ms   Send:    HTP indication queued into BLE stack → CPU returns to sleep
```

The I2C peripheral is initialised immediately before each phase and released immediately after — it is never held while the CPU is sleeping.

### RAM retention during sleep

Two RAM blocks are retained during extended sleep:
- **Block 1** (`CFG_RETAIN_RAM_1_BLOCK`): application state, BLE stack data.
- **Non-retained heap** is automatically retained if it contains live messages (`CFG_AUTO_DETECT_NON_RET_HEAP`).

### Low-power clock

The internal **RCX20** oscillator (`LP_CLK_RCX20`) is used as the low-power clock — no external 32 kHz crystal is required. Drift is configured at **500 ppm** (`CFG_NVDS_TAG_LPCLK_DRIFT`).

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

```
BLE event loop
  └─ temp_timer_cb  (fires every interval)
       └─ i2c_temp_sensor_trigger()  → returns immediately
            └─ on_trigger_done()  [I2C ISR]
                 └─ app_easy_timer(90 ms, aht20_read_cb)
                      └─ aht20_read_cb()  [BLE event loop]
                           └─ i2c_temp_sensor_read()  → returns immediately
                                └─ on_read_done()  [I2C ISR]
                                     └─ app_easy_timer(1 tick, send_indication_cb)
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

### BLE profiles — `src/config/user_profiles_config.h`

| Define | Default | Description |
|--------|---------|-------------|
| `CFG_PRF_HTPT` | defined | Health Thermometer Profile (server) — required |
| `CFG_PRF_BASS` | defined | Battery Service (server) — reports battery level |
| `CFG_PRF_DISS` | *(undefined)* | Device Information Service — disabled to save memory |
| `APP_HTPT_MEAS_INTERVAL` | `5` | Default HTP measurement interval in seconds |
| `APP_HTPT_VALID_RANGE_MIN` | `1` | Minimum interval the collector may write (seconds) |
| `APP_HTPT_VALID_RANGE_MAX` | `60` | Maximum interval the collector may write (seconds) |
| `APP_BASS_POLL_INTERVAL` | `6000` | Battery level polling interval in 10 ms ticks (= 60 s) |

### Basic chip config — `src/config/da14535_config_basic.h`

| Define | Default | Description |
|--------|---------|-------------|
| `CFG_WDOG` | defined | Watchdog timer enabled |
| `CFG_WDG_TRIGGER_HW_RESET_IN_PRODUCTION_MODE` | *(undefined)* | Watchdog triggers NMI (not hard reset) at zero |
| `CFG_DEVELOPMENT_DEBUG` | defined | Debug mode: OTP mirror emulation, GPIO reservation checks, breakpoints in fault handlers. **Undefine for production builds.** |
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

---

## Project structure

```
thermometer/
├── build.sh                    Standalone GCC build script
├── README.md                   This file
├── build/
│   └── DA14535/                GCC build output (generated)
│       ├── thermometer.elf
│       ├── thermometer.hex
│       └── thermometer.map
└── src/
    ├── thermometer.c           Application logic and BLE state machine
    ├── thermometer.h           Application compile-time config (CFG_TEMP_RAW_CELSIUS,
    │                           TEMP_MEAS_INTERVAL_DEFAULT_SEC)
    ├── i2c_temp_sensor.c       AHT20 async interrupt-driven I2C driver
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
