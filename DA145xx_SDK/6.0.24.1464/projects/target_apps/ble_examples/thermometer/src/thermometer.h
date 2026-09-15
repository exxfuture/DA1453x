/**
 ****************************************************************************************
 *
 * @file thermometer.h
 *
 * @brief BLE Thermometer application header.
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#ifndef _THERMOMETER_H_
#define _THERMOMETER_H_

#include <stdint.h>
#include <stdbool.h>
#include "gapc_task.h"
#include "arch_api.h"

/*
 * DEFINES
 ****************************************************************************************
 */

/// Default temperature measurement interval in seconds
#define TEMP_MEAS_INTERVAL_DEFAULT_SEC  5

/// Samples taken per measurement cycle (1..3). 3 -> median, 2 -> mean, 1 -> raw.
#define TEMP_SAMPLES_PER_MEASUREMENT    3

/// Gap between samples within one cycle, in 10 ms timer ticks (10 = 100 ms)
#define TEMP_SAMPLE_GAP_TICKS           10

/**
 * Calibration offset added to every reported temperature, in 0.01 degC units
 * (e.g. -30 = report 0.30 degC lower).  Compensates a fixed skin-to-sensor
 * offset; 0 = no correction.
 */
#define CFG_TEMP_OFFSET_X100            0

/// Consecutive fully-failed measurement cycles before an AHT20 soft reset
#define AHT20_FAILS_BEFORE_SOFT_RESET   5

/// Consecutive fully-failed cycles before SCL bus recovery (multiple of the above)
#define AHT20_FAILS_BEFORE_BUS_RECOVERY 10

/*
 * Compile-time guards for the tuning constants above.  aggregate_samples_i16()
 * (codec.h) only knows median-of-3 / mean-of-2 / single, so more than three
 * samples per cycle would silently discard the extra ones; and the recovery
 * ladder (recovery_action(), codec.h) only fires at the documented cadence
 * when the bus-recovery threshold is a multiple of the soft-reset one.
 */
_Static_assert(TEMP_SAMPLES_PER_MEASUREMENT >= 1 && TEMP_SAMPLES_PER_MEASUREMENT <= 3,
               "TEMP_SAMPLES_PER_MEASUREMENT must be 1..3 (aggregate_samples_i16 supports no more)");
_Static_assert(AHT20_FAILS_BEFORE_SOFT_RESET > 0,
               "AHT20_FAILS_BEFORE_SOFT_RESET must be > 0");
_Static_assert(AHT20_FAILS_BEFORE_BUS_RECOVERY % AHT20_FAILS_BEFORE_SOFT_RESET == 0,
               "AHT20_FAILS_BEFORE_BUS_RECOVERY must be a multiple of AHT20_FAILS_BEFORE_SOFT_RESET");

/**
 * BLE transmit power level (rf_tx_pwr_lvl_t, applied in periph_init).
 * RF_TX_PWR_LVL_0d0 = 0 dBm — ample for bedside range and cheaper than the
 * +2.5 dBm maximum.  Comment out to keep the SDK default (maximum).
 */
#define CFG_TX_POWER_LEVEL              RF_TX_PWR_LVL_0d0

/**
 * CFG_TEMP_RAW_CELSIUS — temperature encoding selector
 *
 * Defined   : Temperature is sent as an IEEE-11073 FLOAT with exponent=0,
 *             mantissa=integer °C.  The Renesas SmartBond iOS app ignores
 *             the exponent and reads the mantissa directly as °C, so this
 *             mode makes SmartBond display the correct temperature.
 *             Resolution: 1 °C.  FE app must have raw Celsius mode enabled.
 *
 * Undefined : Temperature is sent as an IEEE-11073 FLOAT with exponent=-2,
 *             mantissa=temp×100.  Standards-compliant 0.01 °C resolution.
 *             Decoded correctly by the FE app (standard mode) and any HTP
 *             collector that applies the exponent.  SmartBond will show
 *             temp×100 (e.g. 2715) rather than 27.15 °C.
 *
 * To enable SmartBond-compatible output, define this flag (line below).
 */
// #define CFG_TEMP_RAW_CELSIUS

/* Selects the sleep mode after advertising timeout */
#undef CFG_APP_GOTO_DEEP_SLEEP

#if defined (__DA14531__)
#undef CFG_APP_GOTO_HIBERNATION
#undef CFG_APP_GOTO_STATEFUL_HIBERNATION
#endif

/*
 * FUNCTION DECLARATIONS
 ****************************************************************************************
 */

void app_button_enable(void);
void app_advertise_complete(const uint8_t status);

void user_app_on_init(void);
void user_app_on_db_init_complete(void);
void user_app_on_connection(uint8_t conidx, struct gapc_connection_req_ind const *param);
void user_app_on_disconnect(struct gapc_disconnect_ind const *param);

void user_catch_rest_hndl(ke_msg_id_t const msgid,
                          void const *param,
                          ke_task_id_t const dest_id,
                          ke_task_id_t const src_id);

void user_htpt_ind_cfg_ind(uint8_t conidx, bool ind_en);
void user_htpt_send_measurement_cfm(uint8_t conidx, uint8_t status);
void user_htpt_meas_intv_chg_cfm(uint8_t conidx, uint16_t intv);

#endif // _THERMOMETER_H_
