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
