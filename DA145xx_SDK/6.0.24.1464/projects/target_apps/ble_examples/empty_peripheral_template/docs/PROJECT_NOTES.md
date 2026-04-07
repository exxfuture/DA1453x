# Project Notes (DA14535 / UM-B-182)

Този проект е базиран на `empty_peripheral_template`, но е разширен с:
1. собствена логика (бутони/изходи/време) в `src/user_empty_peripheral_template.c`
2. UART debug през `arch_console` (CFG_PRINTF)

## Хардуер

Таргет: **DA14535 USB Development Kit (UM-B-182)**.

## Структура (важните файлове)

- UART/GPIO init:
  - `src/platform/user_periph_setup.c`
  - `src/config/user_periph_setup.h`
- App логика (BLE + таймери + GPIO):
  - `src/user_empty_peripheral_template.c`
  - `src/user_empty_peripheral_template.h`
- Callback “hook”-ове към SDK:
  - `src/config/user_callback_config.h`
- Compile-time конфигурации (DA14535):
  - `src/config/da14535_config_basic.h` (тук е `CFG_PRINTF`)
  - `src/config/da14535_config_advanced.h`

## GPIO Пинове (в текущата конфигурация)

Дефинирани са в `src/config/user_periph_setup.h`.

- `BUTTON1`: `P0_7` (active-low, pull-up)
- `BUTTON2`: `P0_6` (active-low, pull-up)
- `OUT1`: `P0_9` (output)
- `OUT2`: `P0_8` (output)

Забележка: ако ползваш SPI flash boot (QSPI), пиновете `P0_0..P0_4` се ползват от flash интерфейса според UM-B-182. Планирай GPIO така, че да няма конфликти.

## UART Debug (CFG_PRINTF)

### Софтуерно

- `src/config/da14535_config_basic.h`:
  - `CFG_PRINTF` е включен
  - `CFG_PRINTF_UART2` е включен → `arch_printf()` пише през UART2 (SDK driver)
- `src/platform/user_periph_setup.c`:
  - конфигурира pads + `uart_initialize(UART2, ...)`
  - печата boot banner и прави `arch_printf_flush()`
- `src/user_empty_peripheral_template.c`:
  - добавен е `user_app_on_init()` (late print), за да има “късен” UART print след системния init
- `src/config/user_callback_config.h`:
  - `app_on_init` е пренасочен към `user_app_on_init`

### Хардуерно (UM-B-182)

UM-B-182 поддържа няколко UART варианта през DIP:

- **2-wire UART**: `P0_0` (TX), `P0_1` (RX)
- **4-wire UART**: `P0_0` (TX), `P0_1` (RX), `P0_3` (CTS), `P0_4` (RTS)
- **1-wire UART (default boot option)**: `P0_5` (TX/RX на един пин)

Ключово за UM-B-182:
- Default boot конфигурацията ползва QSPI flash и закача `P0_0..P0_4` към QSPI (DIP 9/8/7/6).
- 1-wire UART се enable-ва от DIP #12 и е на `P0_5`.
- За 2/4-wire UART трябва да пренастроиш DIP така, че `P0_0..P0_4` да са свързани към UART (и тогава QSPI boot не може да се ползва по същия начин).

Текущият проект е настроен за **2-wire UART2 на P0_0/P0_1** (виж `UART2_TX_PIN/UART2_RX_PIN` в `src/config/user_periph_setup.h`).

## BLE функционалност (накратко)

В `src/user_empty_peripheral_template.c`:

- Бутони:
  - периодично polling (таймер ~20ms)
  - при промяна изпраща NOTIFY към characteristic-а за бутони (ако е enable-нат CCCD)
- Изходи:
  - приема WRITE (1 byte mask) и управлява `OUT1/OUT2`
- Време:
  - `SetTime` (WRITE, 4 bytes little-endian epoch)
  - `Time` (READ/NOTIFY, 4 bytes little-endian epoch)

## Известен проблем (UART “не излъчва” / спира в ASSERT)

Ако дебъгерът спира на:

`sdk/platform/arch/main/jump_table.c` → `platform_reset_func()`:

`ASSERT_WARNING(error == RESET_AFTER_SUOTA_UPDATE);`

това означава, че се прави `platform_reset()` с причина различна от `RESET_AFTER_SUOTA_UPDATE`, а при `CFG_DEVELOPMENT_DEBUG` това води до `BKPT` и системата спира → няма UART изход.

Safe workaround-и (без “магия”):

- Временно изключи `CFG_DEVELOPMENT_DEBUG` (така `ASSERT_WARNING` няма да halt-ва).
- Или дефинирай `CFG_PRODUCTION_TEST` (така `PRODUCTION_TEST=1` и този assert в `platform_reset_func()` няма да се компилира).
- Или направи локален patch на `platform_reset_func()` да не assert-ва за всички reset причини (най-чисто за dev).

## Логика за дебъг (какво да очакваш на терминала)

При работещ UART:
- `=== DA14535 BOOT ===`
- `UART2: P0_X (TX), P0_Y (RX) @ 115200`
- `[BOOT] app_on_init UART OK`
