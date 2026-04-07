---
name: empty_peripheral_template
boards: [da14535]
keywords:
  - empty peripheral template
  - ble peripheral
  - um-b-182
description: |
  SDK6 example-based project, adapted for DA14535 USB Development Kit (UM-B-182).
---

# empty_peripheral_template

## Local Project Notes (DA14535 / UM-B-182)

Виж `docs/PROJECT_NOTES.md` за:
- pinout (бутони/изходи)
- UART debug (UM-B-182: 1-wire/2-wire/4-wire)
- текущия статус на проблема с UART (вкл. reset ASSERT-а) и safe workaround-и

## Example description

This project is based on the SDK6 `empty_peripheral_template` sample.

Devices naming:
- DA1453x refers to DA14531-00, DA14531-01, DA14530 and DA14535.
- DA1458x refers to DA14585 and DA14586.

## HW and SW configuration

This project runs on the BLE Smart SoC (System on Chip) devices.

SDK references:
- SDK6 latest version: `https://www.renesas.com/sdk6_latest`

Tools:
- e2 studio
- SEGGER J-Link tools

## How to run the example

For the initial setup of the project that involves linking the SDK to this SW example, please follow the Readme `../../Readme.md`.

## Further reading

- Wireless Connectivity Forum: `https://lpccs-docs.renesas.com/lpc_docs_index/DA145xx.html`

## Known Limitations

- No known limitations for the original template.
- For this local project, see `docs/PROJECT_NOTES.md` (UART/boot specifics).

