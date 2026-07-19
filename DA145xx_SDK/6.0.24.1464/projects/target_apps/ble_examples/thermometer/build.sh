#!/usr/bin/env bash
# ============================================================
# BLE Thermometer — standalone GCC build script
# Target: DA14535-00FXDEVKT-U
# Toolchain: arm-none-eabi-gcc (ARM GNU Toolchain 11.3+)
#
# Usage:
#   bash build.sh          # development build (CFG_DEVELOPMENT_DEBUG on)
#   bash build.sh release  # production build  (-DCFG_PRODUCTION, debug off)
#   bash build.sh clean    # clean build output (all modes)
#
# Incremental: unchanged sources are skipped via GCC .d dependency files.
# A change to this script's flags forces a full rebuild automatically.
# Also generates compile_commands.json for clangd.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="${SCRIPT_DIR}/../../../.."
SRC="${SCRIPT_DIR}/src"

export PATH="/Applications/ArmGNUToolchain/11.3.rel1/arm-none-eabi/bin:${PATH}"
CC="arm-none-eabi-gcc"
OBJCOPY="arm-none-eabi-objcopy"
TARGET="DA14535"
DEFINE="-D__DA14531__ -D__DA14535__"

MODE="${1:-dev}"

# ---- CLEAN -------------------------------------------------------
if [[ "${MODE}" == "clean" ]]; then
    rm -rf "${SCRIPT_DIR}/build"
    echo "Clean done."
    exit 0
fi

if [[ "${MODE}" == "release" ]]; then
    DEFINE="${DEFINE} -DCFG_PRODUCTION"
    BUILD="${SCRIPT_DIR}/build/DA14535-release"
    echo "=== RELEASE build (CFG_DEVELOPMENT_DEBUG disabled) ==="
else
    BUILD="${SCRIPT_DIR}/build/DA14535"
fi

mkdir -p "${BUILD}"

# ---- LDSCRIPT ----------------------------------------------------
LDSCRIPT_TPL="${SDK_ROOT}/sdk/common_project_files/ldscripts/ldscript_DA14535.lds.S"
LDSCRIPT="${BUILD}/ldscript_DA14535.lds"

"${CC}" -E -P \
    ${DEFINE} \
    -I"${SDK_ROOT}/sdk/common_project_files" \
    -I"${SRC}/config" \
    -x c "${LDSCRIPT_TPL}" -o "${LDSCRIPT}"

# ---- CFLAGS ------------------------------------------------------
INCLUDES=(
    -I"${SDK_ROOT}/sdk/app_modules/api"
    -I"${SDK_ROOT}/sdk/platform/include/CMSIS/5.9.0/CMSIS/Core/Include"
    -I"${SDK_ROOT}/sdk/ble_stack/controller/em"
    -I"${SDK_ROOT}/sdk/ble_stack/controller/llc"
    -I"${SDK_ROOT}/sdk/ble_stack/controller/lld"
    -I"${SDK_ROOT}/sdk/ble_stack/controller/llm"
    -I"${SDK_ROOT}/sdk/ble_stack/ea/api"
    -I"${SDK_ROOT}/sdk/ble_stack/em/api"
    -I"${SDK_ROOT}/sdk/ble_stack/hci/api"
    -I"${SDK_ROOT}/sdk/ble_stack/hci/src"
    -I"${SDK_ROOT}/sdk/ble_stack/host/att"
    -I"${SDK_ROOT}/sdk/ble_stack/host/att/attc"
    -I"${SDK_ROOT}/sdk/ble_stack/host/att/attm"
    -I"${SDK_ROOT}/sdk/ble_stack/host/att/atts"
    -I"${SDK_ROOT}/sdk/ble_stack/host/gap"
    -I"${SDK_ROOT}/sdk/ble_stack/host/gap/gapc"
    -I"${SDK_ROOT}/sdk/ble_stack/host/gap/gapm"
    -I"${SDK_ROOT}/sdk/ble_stack/host/gatt"
    -I"${SDK_ROOT}/sdk/ble_stack/host/gatt/gattc"
    -I"${SDK_ROOT}/sdk/ble_stack/host/gatt/gattm"
    -I"${SDK_ROOT}/sdk/ble_stack/host/l2c/l2cc"
    -I"${SDK_ROOT}/sdk/ble_stack/host/l2c/l2cm"
    -I"${SDK_ROOT}/sdk/ble_stack/host/smp"
    -I"${SDK_ROOT}/sdk/ble_stack/host/smp/smpc"
    -I"${SDK_ROOT}/sdk/ble_stack/host/smp/smpm"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/bas/basc/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/bas/bass/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/htp"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/htp/htpc/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/htp/htpt/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/dis/disc/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/dis/diss/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/prox/proxm/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/prox/proxr/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/suota/suotar/api"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/custom"
    -I"${SDK_ROOT}/sdk/ble_stack/profiles/custom/custs/api"
    -I"${SDK_ROOT}/sdk/ble_stack/rwble"
    -I"${SDK_ROOT}/sdk/ble_stack/rwble_hl"
    -I"${SDK_ROOT}/sdk/common_project_files"
    -I"${SDK_ROOT}/sdk/platform/arch"
    -I"${SDK_ROOT}/sdk/platform/arch/boot"
    -I"${SDK_ROOT}/sdk/platform/arch/boot/ARM"
    -I"${SDK_ROOT}/sdk/platform/arch/boot/GCC"
    -I"${SDK_ROOT}/sdk/platform/arch/compiler"
    -I"${SDK_ROOT}/sdk/platform/arch/ll"
    -I"${SDK_ROOT}/sdk/platform/arch/main"
    -I"${SDK_ROOT}/sdk/platform/core_modules/arch_console"
    -I"${SDK_ROOT}/sdk/platform/core_modules/common/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/crypto"
    -I"${SDK_ROOT}/sdk/platform/core_modules/dbg/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/gtl/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/gtl/src"
    -I"${SDK_ROOT}/sdk/platform/core_modules/h4tl/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/ke/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/ke/src"
    -I"${SDK_ROOT}/sdk/platform/core_modules/nvds/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/rf/api"
    -I"${SDK_ROOT}/sdk/platform/core_modules/rwip/api"
    -I"${SDK_ROOT}/sdk/platform/driver/adc"
    -I"${SDK_ROOT}/sdk/platform/driver/battery"
    -I"${SDK_ROOT}/sdk/platform/driver/ble"
    -I"${SDK_ROOT}/sdk/platform/driver/dma"
    -I"${SDK_ROOT}/sdk/platform/driver/gpio"
    -I"${SDK_ROOT}/sdk/platform/driver/hw_otpc"
    -I"${SDK_ROOT}/sdk/platform/driver/i2c"
    -I"${SDK_ROOT}/sdk/platform/driver/i2c_eeprom"
    -I"${SDK_ROOT}/sdk/platform/driver/pdm"
    -I"${SDK_ROOT}/sdk/platform/driver/reg"
    -I"${SDK_ROOT}/sdk/platform/driver/rtc"
    -I"${SDK_ROOT}/sdk/platform/driver/spi"
    -I"${SDK_ROOT}/sdk/platform/driver/spi_flash"
    -I"${SDK_ROOT}/sdk/platform/driver/spi_hci"
    -I"${SDK_ROOT}/sdk/platform/driver/syscntl"
    -I"${SDK_ROOT}/sdk/platform/driver/systick"
    -I"${SDK_ROOT}/sdk/platform/driver/timer"
    -I"${SDK_ROOT}/sdk/platform/driver/trng"
    -I"${SDK_ROOT}/sdk/platform/driver/uart"
    -I"${SDK_ROOT}/sdk/platform/driver/wkupct_quadec"
    -I"${SDK_ROOT}/sdk/platform/include"
    -I"${SDK_ROOT}/sdk/platform/system_library/include"
    -I"${SDK_ROOT}/third_party/hash"
    -I"${SDK_ROOT}/third_party/irng"
    -I"${SDK_ROOT}/third_party/rand"
    -I"${SDK_ROOT}/sdk/platform/utilities/otp_cs"
    -I"${SDK_ROOT}/sdk/platform/utilities/otp_hdr"
    -I"${SRC}/config"
    -I"${SRC}"
)

CFLAGS=(
    -mcpu=cortex-m0plus -mthumb
    -Os -fmessage-length=0 -fsigned-char
    -ffunction-sections -fdata-sections -flto
    -fno-exceptions -fno-unwind-tables -fno-asynchronous-unwind-tables
    -Wall -g0
    ${DEFINE}
    -std=gnu99
    -Wno-int-conversion -Wno-unused-variable
    -MMD -MP
    -include"${SRC}/config/da1458x_config_basic.h"
    -include"${SRC}/config/da1458x_config_advanced.h"
    -include"${SRC}/config/user_config.h"
)

LDFLAGS=(
    -mcpu=cortex-m0plus -mthumb
    -Os -fmessage-length=0 -fsigned-char
    -ffunction-sections -fdata-sections -flto
    -fno-exceptions -fno-unwind-tables -fno-asynchronous-unwind-tables
    -Wall -g0
    -T"${LDSCRIPT}"
    -Xlinker --gc-sections
    -Wl,--strip-debug -Wl,--strip-discarded -Wl,--as-needed
    -L"${SDK_ROOT}/sdk/platform/system_library/output/Keil_5"
    -L"${SDK_ROOT}/sdk/common_project_files/misc"
    -Wl,-Map,"${BUILD}/thermometer.map"
    --specs=nano.specs --specs=nosys.specs
    -Wl,--no-wchar-size-warning
)

ELF="${BUILD}/thermometer.elf"
HEX="${BUILD}/thermometer.hex"

# ---- SOURCE FILES -----------------------------------------------
SDK="${SDK_ROOT}/sdk"

SDK_APP_SRCS=(
    "${SDK}/app_modules/src/app_common/app.c"
    "${SDK}/app_modules/src/app_bass/app_bass.c"
    "${SDK}/app_modules/src/app_bass/app_bass_task.c"
    "${SDK}/app_modules/src/app_diss/app_diss.c"
    "${SDK}/app_modules/src/app_diss/app_diss_task.c"
    "${SDK}/app_modules/src/app_bond_db/app_bond_db.c"
    "${SDK}/app_modules/src/app_default_hnd/app_default_handlers.c"
    "${SDK}/app_modules/src/app_easy/app_easy_crypto.c"
    "${SDK}/app_modules/src/app_easy/app_easy_msg_utils.c"
    "${SDK}/app_modules/src/app_easy/app_easy_security.c"
    "${SDK}/app_modules/src/app_easy/app_easy_storage.c"
    "${SDK}/app_modules/src/app_easy/app_easy_timer.c"
    "${SDK}/app_modules/src/app_entry/app_entry_point.c"
    "${SDK}/app_modules/src/app_htpt/app_htpt.c"
    "${SDK}/app_modules/src/app_htpt/app_htpt_task.c"
    "${SDK}/app_modules/src/app_common/app_msg_utils.c"
    "${SDK}/app_modules/src/app_sec/app_security.c"
    "${SDK}/app_modules/src/app_sec/app_security_task.c"
    "${SDK}/app_modules/src/app_common/app_task.c"
    "${SDK}/app_modules/src/app_common/app_utils.c"
)

SDK_ARCH_SRCS=(
    "${SDK}/platform/core_modules/arch_console/arch_console.c"
    "${SDK}/platform/arch/main/arch_hibernation.c"
    "${SDK}/platform/arch/main/arch_main.c"
    "${SDK}/platform/arch/main/arch_rom.c"
    "${SDK}/platform/arch/main/arch_sleep.c"
    "${SDK}/platform/arch/main/arch_system.c"
    "${SDK_ROOT}/third_party/rand/chacha20.c"
    "${SDK_ROOT}/third_party/hash/hash.c"
    "${SDK}/platform/arch/main/jump_table.c"
    "${SDK}/platform/core_modules/nvds/src/nvds.c"
    "${SDK}/platform/utilities/otp_cs/otp_cs.c"
    "${SDK}/platform/utilities/otp_hdr/otp_hdr.c"
    "${SDK}/platform/system_library/src/DA14531/system_library_531.c"
    "${SDK}/platform/system_library/src/DA14531_01/system_library_531_01.c"
    "${SDK}/platform/system_library/src/DA14535/system_library_535.c"
    "${SDK}/platform/system_library/src/DA14585_586/system_library_585_586.c"
)

SDK_BLE_SRCS=(
    "${SDK}/platform/core_modules/rf/src/ble_arp.c"
    "${SDK}/platform/core_modules/rf/src/rf_531.c"
    "${SDK}/ble_stack/rwble/rwble.c"
    "${SDK}/platform/core_modules/rwip/src/rwip.c"
)

SDK_BOOT_SRCS=(
    "${SDK}/platform/arch/main/hardfault_handler.c"
    "${SDK}/platform/arch/main/nmi_handler.c"
    "${SDK}/platform/arch/boot/startup_DA14535.c"
    "${SDK}/platform/arch/boot/system_DA14535.c"
)

SDK_DRIVER_SRCS=(
    "${SDK}/platform/driver/adc/adc_531.c"
    "${SDK}/platform/driver/battery/battery.c"
    "${SDK}/platform/driver/dma/dma.c"
    "${SDK}/platform/driver/gpio/gpio.c"
    "${SDK}/platform/driver/hw_otpc/hw_otpc_531.c"
    "${SDK}/platform/driver/i2c/i2c.c"
    "${SDK}/platform/driver/syscntl/syscntl.c"
    "${SDK}/platform/driver/timer/timer1.c"
    "${SDK}/platform/driver/trng/trng.c"
    "${SDK}/platform/driver/uart/uart.c"
    "${SDK}/platform/driver/wkupct_quadec/wkupct_quadec.c"
)

SDK_PROFILE_SRCS=(
    "${SDK}/ble_stack/profiles/bas/bass/src/bass.c"
    "${SDK}/ble_stack/profiles/bas/bass/src/bass_task.c"
    "${SDK}/ble_stack/profiles/dis/diss/src/diss.c"
    "${SDK}/ble_stack/profiles/dis/diss/src/diss_task.c"
    "${SDK}/ble_stack/profiles/htp/htpt/src/htpt.c"
    "${SDK}/ble_stack/profiles/htp/htpt/src/htpt_task.c"
    "${SDK}/ble_stack/profiles/prf.c"
    "${SDK}/ble_stack/profiles/prf_utils.c"
)

USER_SRCS=(
    "${SRC}/thermometer.c"
    "${SRC}/i2c_temp_sensor.c"
    "${SRC}/platform/user_periph_setup.c"
)

ALL_SRCS=(
    "${SDK_BOOT_SRCS[@]}"
    "${SDK_APP_SRCS[@]}"
    "${SDK_ARCH_SRCS[@]}"
    "${SDK_BLE_SRCS[@]}"
    "${SDK_DRIVER_SRCS[@]}"
    "${SDK_PROFILE_SRCS[@]}"
    "${USER_SRCS[@]}"
)

# ---- CONFIG HASH (flag change -> full rebuild) ------------------
CONFIG_HASH=$(printf '%s' "${CFLAGS[*]} ${INCLUDES[*]}" | cksum | cut -d' ' -f1)
HASH_FILE="${BUILD}/_config_hash"
if [[ ! -f "${HASH_FILE}" || "$(cat "${HASH_FILE}")" != "${CONFIG_HASH}" ]]; then
    rm -f "${BUILD}"/*.o "${BUILD}"/*.d
    printf '%s' "${CONFIG_HASH}" > "${HASH_FILE}"
fi

# ---- COMPILE_COMMANDS.JSON (for clangd) -------------------------
CCDB="${SCRIPT_DIR}/compile_commands.json"
{
    echo "["
    first=1
    for src in "${ALL_SRCS[@]}"; do
        [[ ${first} -eq 0 ]] && echo ","
        first=0
        printf '  {"directory": "%s", "file": "%s", "command": "%s %s %s -c %s"}' \
            "${SCRIPT_DIR}" "${src}" "${CC}" "${CFLAGS[*]}" "${INCLUDES[*]}" "${src}"
    done
    echo ""
    echo "]"
} > "${CCDB}"

# ---- INCREMENTAL CHECK ------------------------------------------
# An object is up to date when it exists and no file in its .d dependency
# list (source + every header it includes) is newer.
needs_compile() {
    local obj="$1" dep="${1%.o}.d" f
    [[ -f "${obj}" && -f "${dep}" ]] || return 0
    while IFS= read -r f; do
        [[ -n "${f}" && "${f}" -nt "${obj}" ]] && return 0
    done < <(sed -e 's/\\$//' -e 's/^[^:]*: *//' "${dep}" | tr ' ' '\n' | sed '/^$/d')
    return 1
}

# ---- COMPILE (parallel) -----------------------------------------
OBJS=()
PIDS=()
FAIL_FLAG="${BUILD}/_build_failed"
rm -f "${FAIL_FLAG}"
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

SKIPPED=0
TO_COMPILE=()
for src in "${ALL_SRCS[@]}"; do
    # Flatten path -> unique object name
    obj="${BUILD}/$(echo "${src}" | sed 's|/|_|g; s|^_||; s|\.c$|.o|')"
    OBJS+=("${obj}")
    if needs_compile "${obj}"; then
        TO_COMPILE+=("${src}|${obj}")
    else
        SKIPPED=$((SKIPPED + 1))
    fi
done

echo "Compiling $(( ${#ALL_SRCS[@]} - SKIPPED )) of ${#ALL_SRCS[@]} source files (${SKIPPED} up to date, ${JOBS} jobs)..."

for entry in "${TO_COMPILE[@]:-}"; do
    [[ -z "${entry}" ]] && continue
    src="${entry%%|*}"
    obj="${entry##*|}"
    (
        # Disable pipefail here: without it, the pipeline exit status is grep's
        # exit status, which leaves PIPESTATUS[0] as gcc's actual exit code even
        # when '|| true' runs (no-output case).  With pipefail inherited from the
        # outer shell, any non-zero pipeline result triggers '|| true', which
        # overwrites PIPESTATUS and silently swallows real compile errors.
        set +o pipefail
        "${CC}" "${CFLAGS[@]}" "${INCLUDES[@]}" -c "${src}" -o "${obj}" 2>&1 \
            | grep -v '^$' || true
        if [[ ${PIPESTATUS[0]} -ne 0 ]]; then touch "${FAIL_FLAG}"; fi
    ) &
    PIDS+=($!)
    while [[ $(jobs -rp | wc -l) -ge ${JOBS} ]]; do sleep 0.05; done
done

for pid in "${PIDS[@]:-}"; do [[ -n "${pid}" ]] && wait "${pid}" 2>/dev/null || true; done

if [[ -f "${FAIL_FLAG}" ]]; then
    echo "ERROR: One or more compilation units failed." >&2
    exit 1
fi

# ---- LINK -------------------------------------------------------
echo "Linking..."
"${CC}" "${LDFLAGS[@]}" -o "${ELF}" "${OBJS[@]}" -l:da14535.lib

# ---- HEX --------------------------------------------------------
"${OBJCOPY}" -O ihex "${ELF}" "${HEX}"

echo ""
echo "Build complete:"
echo "  ELF: ${ELF}"
echo "  HEX: ${HEX}"
arm-none-eabi-size "${ELF}"
