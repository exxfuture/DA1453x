/**
 ****************************************************************************************
 *
 * @file user_tempr.c
 *
 * @brief Temperature reporter project source code.
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 * This software ("Software") is supplied by Renesas Electronics Corporation and/or its
 * affiliates ("Renesas"). Renesas grants you a personal, non-exclusive, non-transferable,
 * revocable, non-sub-licensable right and license to use the Software, solely if used in
 * or together with Renesas products. You may make copies of this Software, provided this
 * copyright notice and disclaimer ("Notice") is included in all such copies. Renesas
 * reserves the right to change or discontinue the Software at any time without notice.
 *
 * THE SOFTWARE IS PROVIDED "AS IS". RENESAS DISCLAIMS ALL WARRANTIES OF ANY KIND,
 * WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. TO THE
 * MAXIMUM EXTENT PERMITTED UNDER LAW, IN NO EVENT SHALL RENESAS BE LIABLE FOR ANY DIRECT,
 * INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE, EVEN IF RENESAS HAS BEEN ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGES. USE OF THIS SOFTWARE MAY BE SUBJECT TO TERMS AND CONDITIONS CONTAINED IN
 * AN ADDITIONAL AGREEMENT BETWEEN YOU AND RENESAS. IN CASE OF CONFLICT BETWEEN THE TERMS
 * OF THIS NOTICE AND ANY SUCH ADDITIONAL LICENSE AGREEMENT, THE TERMS OF THE AGREEMENT
 * SHALL TAKE PRECEDENCE. BY CONTINUING TO USE THIS SOFTWARE, YOU AGREE TO THE TERMS OF
 * THIS NOTICE.IF YOU DO NOT AGREE TO THESE TERMS, YOU ARE NOT PERMITTED TO USE THIS
 * SOFTWARE.
 *
 ****************************************************************************************
 */

/**
 ****************************************************************************************
 * @addtogroup APP
 * @{
 ****************************************************************************************
 */

/*
 * INCLUDE FILES
 ****************************************************************************************
 */

#include "rwip_config.h"
#include "gattc_task.h"
#include "gapc_task.h"
#include "user_periph_setup.h"
#include "wkupct_quadec.h"
#include "app_easy_msg_utils.h"
#include "gpio.h"
#include "app_security.h"
#include "user_tempr.h"
#include "arch.h"
#include "arch_api.h"
#if defined (__DA14531__) && (defined (CFG_APP_GOTO_HIBERNATION) || defined (CFG_APP_GOTO_STATEFUL_HIBERNATION))
#include "arch_hibernation.h"
#endif
#include "app_task.h"
#include "app_htpt.h"
#include "htpt_task.h"
#include "htp_common.h"
#include "app_bass.h"
#include "app_bass_task.h"
#include "app_entry_point.h"
//#include "app_suotar.h"  // Disabled due to include path issues
#include "adc.h"
#include "arch_console.h"
#include "gattc_task.h"
#include "ke_msg.h"
#include "user_profiles_config.h"
#include "app_easy_timer.h"
#include "app_default_handlers.h"

#if defined (__DA14531__)
#include "rtc.h"
#include "timer1.h"
#endif

/*
 * GLOBAL VARIABLE DEFINITIONS
 ****************************************************************************************
 */

/// Temperature measurement interval in milliseconds
static uint16_t temp_measurement_interval = TEMP_MEAS_INTERVAL_DEFAULT;

/// Temperature measurement timer ID
static timer_hnd temp_measurement_timer = EASY_TIMER_INVALID_TIMER;

/// Current connection index
static uint8_t current_conidx = GAP_INVALID_CONIDX;

/// Track if client has enabled temperature measurement indications
static bool indications_enabled = false;

/// Current battery level (0-100%)
static uint8_t battery_level = 100;

// Forward declarations for HTPT callbacks
void user_htpt_ind_cfg_ind(uint8_t conidx, bool ind_en);
void user_htpt_send_measurement_cfm(uint8_t conidx, uint8_t status);

// Forward declarations for battery functions
static void update_battery_level(void);

// HTPT callback structure is defined in user_callback_config.h

/*
 * FUNCTION DEFINITIONS
 ****************************************************************************************
 */

/**
 ****************************************************************************************
 * @brief Check if temperature measurement indications are enabled by the client.
 * @return true if indications are enabled, false otherwise
 ****************************************************************************************
 */
static bool are_indications_enabled(void)
{
    return indications_enabled;
}

/**
 ****************************************************************************************
 * @brief Button press callback function. Registered in WKUPCT driver.
 ****************************************************************************************
 */
static void app_button_press_cb(void)
{
#if defined (__DA14531__)
    periph_init();
#else
    if (GetBits16(SYS_STAT_REG, PER_IS_DOWN))
    {
        periph_init();
    }
#endif

    if (arch_ble_ext_wakeup_get())
    {
        arch_set_sleep_mode(app_default_sleep_mode);
        arch_ble_force_wakeup();
        arch_ble_ext_wakeup_off();
        app_easy_wakeup();
    }
}

/**
 ****************************************************************************************
 * @brief Enable push button. Register callback function for button press event.
 *        Must be called in periph_setup().
 ****************************************************************************************
 */
void app_button_enable(void)
{
    app_easy_wakeup_set(app_button_press_cb);
}

/**
 ****************************************************************************************
 * @brief Convert ADC raw value to temperature in range 36-40°C.
 * @param[in] adc_raw Raw ADC value from P0_6
 * @return Temperature in Celsius (36-40°C range)
 ****************************************************************************************
 */
static float adc_to_temperature(uint16_t adc_raw)
{
    // Simple linear mapping: ADC value (0-1023) to temperature range (36.0-40.0°C)
    return 36.0f + ((float)adc_raw / 1023.0f) * 4.0f;
}

/**
 ****************************************************************************************
 * @brief Read temperature from P0_6 ADC input and send measurement.
 ****************************************************************************************
 */
void temp_read_and_send(void)
{
    // Read and send temperature measurement

    // Check if we have a valid connection and indications are enabled
    if (current_conidx != GAP_INVALID_CONIDX && are_indications_enabled())
    {
        // Configure ADC for P0_6 external input reading
        adc_config_t temp_config = {
            .input_mode = ADC_INPUT_MODE_SINGLE_ENDED,
            .input = ADC_INPUT_SE_P0_6,
            .smpl_time_mult = 2,
            .continuous = false,
            .input_attenuator = ADC_INPUT_ATTN_NO, // No attenuation for 0-0.9V range
            .chopping = false,
            .oversampling = 2
        };

        // Initialize ADC
        adc_init(&temp_config);

        // Small delay to let ADC settle
        arch_asm_delay_us(20);

        // Read raw ADC value from P0_6
        uint16_t adc_raw = adc_get_sample();

        // Disable ADC to save power
        adc_disable();

        // Convert ADC reading to temperature (36-40°C range)
        float temperature_celsius = adc_to_temperature(adc_raw);

        // Convert to IEEE-11073 32-bit FLOAT format (required by BLE Health Thermometer Profile)
        // IEEE-11073 FLOAT format: Bits 0-23: Mantissa, Bits 24-31: Exponent
        // For temperature with 0.1°C resolution: mantissa = temp * 10, exponent = -1
        int32_t mantissa = (int32_t)(temperature_celsius * 10); // Convert to 0.1°C units
        int8_t exponent = -1; // Since we multiplied by 10 = 10^1

        // Pack into IEEE-11073 FLOAT format
        uint32_t temp_ieee = (mantissa & 0x00FFFFFF) | ((exponent & 0xFF) << 24);

        // Create temperature measurement structure
        struct htp_temp_meas temp_meas;
        temp_meas.temp = temp_ieee;
        temp_meas.flags = HTP_FLAG_CELSIUS; // Temperature in Celsius
        temp_meas.type = HTP_TYPE_BODY;     // Body temperature type

        // Send temperature measurement using standard HTPT profile
        app_htpt_send_measurement(current_conidx, true, &temp_meas);

        // Update battery level (simulate discharge)
        update_battery_level();
    }

    // Note: Timer scheduling is now handled in the timer callback to avoid interference with HTPT profile
}

/**
 ****************************************************************************************
 * @brief Temperature measurement timer callback function.
 ****************************************************************************************
 */
void temp_measurement_timer_cb(void)
{
    // Timer callback: read and send temperature

    // Reset timer ID since this timer has expired
    temp_measurement_timer = EASY_TIMER_INVALID_TIMER;

    // Take measurement and send it
    temp_read_and_send();

    // Schedule next measurement if indications are still enabled
    if (indications_enabled && current_conidx != GAP_INVALID_CONIDX)
    {
        temp_measurement_timer = app_easy_timer(temp_measurement_interval / 10, temp_measurement_timer_cb);
        // Schedule next measurement
    }
}

/**
 * @brief HTPT indication configuration callback
 * @param conidx Connection index
 * @param ind_en Indication enabled/disabled
 */
void user_htpt_ind_cfg_ind(uint8_t conidx, bool ind_en)
{
    // Handle indication configuration change

    // Update global indication state
    indications_enabled = ind_en;

    if (ind_en)
    {
        // Client enabled indications - start temperature measurements

        // Stop any existing timer first
        if (temp_measurement_timer != EASY_TIMER_INVALID_TIMER)
        {
            app_easy_timer_cancel(temp_measurement_timer);
            temp_measurement_timer = EASY_TIMER_INVALID_TIMER;
        }

        // Start new timer
        temp_measurement_timer = app_easy_timer(temp_measurement_interval / 10, temp_measurement_timer_cb);
    }
    else
    {
        // Client disabled indications - stop temperature measurements
        if (temp_measurement_timer != EASY_TIMER_INVALID_TIMER)
        {
            app_easy_timer_cancel(temp_measurement_timer);
            temp_measurement_timer = EASY_TIMER_INVALID_TIMER;
        }
    }
}

/**
 * @brief HTPT measurement send confirmation callback
 * @param conidx Connection index
 * @param status Send status
 */
void user_htpt_send_measurement_cfm(uint8_t conidx, uint8_t status)
{
    // Handle measurement send confirmation
    if (status != GAP_ERR_NO_ERROR)
    {
        // Measurement send failed - could log error if needed
    }

    // The HTPT profile automatically handles the confirmation and state management
    // No additional action needed here
}

/**
 * @brief HTPT measurement interval change confirmation callback
 * @param conidx Connection index
 * @param intv New measurement interval
 */
void user_htpt_meas_intv_chg_cfm(uint8_t conidx, uint16_t intv)
{
    // Handle measurement interval change request from client
    // Validate interval range (1-60 seconds as defined in user_profiles_config.h)
    if (intv >= APP_HTPT_VALID_RANGE_MIN && intv <= APP_HTPT_VALID_RANGE_MAX)
    {
        // Update our local measurement interval
        temp_set_measurement_interval(intv * 1000); // Convert seconds to milliseconds

        // Send confirmation to HTPT profile that interval change is accepted
        app_htpt_send_measurement_interval_chg_cfm(conidx, GAP_ERR_NO_ERROR);
    }
    else
    {
        // Send error response for out-of-range interval
        app_htpt_send_measurement_interval_chg_cfm(conidx, HTP_OUT_OF_RANGE_ERR_CODE);
    }
}

/**
 ****************************************************************************************
 * @brief Set temperature measurement interval.
 * @param[in] interval_ms Measurement interval in milliseconds
 ****************************************************************************************
 */
void temp_set_measurement_interval(uint16_t interval_ms)
{
    // Validate interval range
    if (interval_ms < TEMP_MEAS_INTERVAL_MIN)
        interval_ms = TEMP_MEAS_INTERVAL_MIN;
    else if (interval_ms > TEMP_MEAS_INTERVAL_MAX)
        interval_ms = TEMP_MEAS_INTERVAL_MAX;
    
    temp_measurement_interval = interval_ms;
    
    // If timer is running, restart it with new interval
    if (temp_measurement_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(temp_measurement_timer);
        temp_measurement_timer = app_easy_timer(temp_measurement_interval / 10, temp_measurement_timer_cb);
    }
}

/**
 ****************************************************************************************
 * @brief Function to be called on the advertising completion event.
 * @param[in] status GAP Error code
 ****************************************************************************************
 */
void app_advertise_complete(const uint8_t status)
{
    if ((status == GAP_ERR_NO_ERROR) || (status == GAP_ERR_CANCELED))
    {
        // Stop any ongoing temperature measurements
        if (temp_measurement_timer != EASY_TIMER_INVALID_TIMER)
        {
            app_easy_timer_cancel(temp_measurement_timer);
            temp_measurement_timer = EASY_TIMER_INVALID_TIMER;
        }
    }

    if (status == GAP_ERR_CANCELED)
    {
        arch_ble_ext_wakeup_on();

#if defined (__DA14531__)
        // Configure wake up from button press
        app_button_enable();

#if defined (CFG_EXT_SLEEP_WAKEUP_TIMER1)
        // Configure Timer1 to wake up system from extended sleep
        timer1_count_options_t timer_cfg = {
            .input_clk = TIM1_CLK_SRC_LP,
            .free_run = TIM1_FREE_RUN_OFF,
            .irq_mask = TIM1_IRQ_MASK_OFF,
            .count_dir = TIM1_CNT_DIR_DOWN,
            .reload_val = (temp_measurement_interval * 32) // 32KHz clock, so multiply by 32 for ms
        };
        timer1_count_config(&timer_cfg, timer1_handler);
        timer1_enable_irq();
        timer1_start();
#endif
#endif

#if defined (CFG_APP_GOTO_DEEP_SLEEP)
        arch_set_deep_sleep(CFG_DEEP_SLEEP_RAM1,
                           CFG_DEEP_SLEEP_RAM2,
                           CFG_DEEP_SLEEP_RAM3,
                           CFG_DEEP_SLEEP_PAD_LATCH_EN);
#elif defined (CFG_APP_GOTO_HIBERNATION)
        arch_set_hibernation(CFG_HIBERNATION_RAM1,
                            CFG_HIBERNATION_RAM2,
                            CFG_HIBERNATION_RAM3,
                            CFG_HIBERNATION_REMAP,
                            CFG_HIBERNATION_PAD_LATCH_EN);
#elif defined (CFG_APP_GOTO_STATEFUL_HIBERNATION)
        arch_set_stateful_hibernation(CFG_STATEFUL_HIBERNATION_RAM1,
                                     CFG_STATEFUL_HIBERNATION_RAM2,
                                     CFG_STATEFUL_HIBERNATION_RAM3,
                                     CFG_STATEFUL_HIBERNATION_REMAP,
                                     CFG_STATEFUL_HIBERNATION_PAD_LATCH_EN);
#endif
    }
}

#if (BLE_SUOTA_RECEIVER)
/**
 ****************************************************************************************
 * @brief Function called when the SUOTAR status changes.
 * @param[in] suotar_event SUOTAR_START or SUOTAR_STOP
 ****************************************************************************************
 */
void on_suotar_status_change(const uint8_t suotar_event)
{
    if (suotar_event == SUOTAR_END)
    {
        // Reboot after SUOTA completion
        platform_reset(RESET_AFTER_SUOTA_UPDATE);
    }
}
#endif

#if defined (__DA14531__)

#if defined (CFG_EXT_SLEEP_WAKEUP_TIMER1)
/**
 ****************************************************************************************
 * @brief Timer1 interrupt handler for temperature measurement wake-up.
 ****************************************************************************************
 */
void timer1_handler(void)
{
    timer1_stop();

    // Take temperature measurement
    temp_read_and_send();

    // Restart timer for next measurement
    timer1_count_options_t timer_cfg = {
        .input_clk = TIM1_CLK_SRC_LP,
        .free_run = TIM1_FREE_RUN_OFF,
        .irq_mask = TIM1_IRQ_MASK_OFF,
        .count_dir = TIM1_CNT_DIR_DOWN,
        .reload_val = (temp_measurement_interval * 32) // 32KHz clock, so multiply by 32 for ms
    };
    timer1_count_config(&timer_cfg, timer1_handler);
    timer1_start();
}
#endif

#endif // __DA14531__

/**
 ****************************************************************************************
 * @brief App initialization function.
 ****************************************************************************************
 */
void user_app_on_init(void)
{
    default_app_on_init();

    // Initialize temperature measurement interval to default
    temp_measurement_interval = TEMP_MEAS_INTERVAL_DEFAULT;
    temp_measurement_timer = EASY_TIMER_INVALID_TIMER;
    current_conidx = GAP_INVALID_CONIDX;
}

/**
 ****************************************************************************************
 * @brief Database creation function.
 ****************************************************************************************
 */
void user_app_on_db_init_complete(void)
{
    default_app_on_db_init_complete();

    // Enable temperature measurement indications by default
    app_htpt_set_initial_measurement_ind_cfg(true);

    // Create Health Thermometer Profile database
    app_htpt_create_db();

    // Initialize and create Battery Service database
    app_batt_init();
    app_bass_create_db();

    // Create SUOTAR Service database - Disabled due to include path issues
    //app_suotar_create_db();
}

/**
 ****************************************************************************************
 * @brief Connection function.
 * @param[in] conidx Connection index
 * @param[in] param  Pointer to GAPC_CONNECTION_REQ_IND message
 ****************************************************************************************
 */
void user_app_on_connection(uint8_t conidx, struct gapc_connection_req_ind const *param)
{
    default_app_on_connection(conidx, param);

    // Store connection index
    current_conidx = conidx;

    // Enable HTPT profile for this connection
    app_htpt_enable(conidx);

    // Enable Battery Service for this connection
    app_bass_enable(conidx);

    // Enable SUOTAR Service for this connection - Disabled due to include path issues
    //app_suotar_enable(conidx);

    // Enable extended sleep mode during connection to save power
    // The device will wake up for BLE events and Timer1 interrupts
    arch_set_sleep_mode(ARCH_EXT_SLEEP_ON);

    // Temperature measurements will start automatically when client enables indications
    // via the HTPT_CFG_INDNTF_IND message handler
}

/**
 ****************************************************************************************
 * @brief Disconnection function.
 * @param[in] param Pointer to GAPC_DISCONNECT_IND message
 ****************************************************************************************
 */
void user_app_on_disconnect(struct gapc_disconnect_ind const *param)
{
    // Stop temperature measurements
    if (temp_measurement_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(temp_measurement_timer);
        temp_measurement_timer = EASY_TIMER_INVALID_TIMER;
    }

#if defined (CFG_EXT_SLEEP_WAKEUP_TIMER1)
    // Stop Timer1 when disconnected to save power
    timer1_stop();
#endif

    current_conidx = GAP_INVALID_CONIDX;
    indications_enabled = false; // Reset indication state on disconnect

    // Continue with extended sleep mode even after disconnection
    // Device will wake up for advertising and button presses
    arch_set_sleep_mode(ARCH_EXT_SLEEP_ON);

    default_app_on_disconnect(param);
}

/**
 ****************************************************************************************
 * @brief Update battery level with simulated discharge
 ****************************************************************************************
 */
static void update_battery_level(void)
{
    // Simulate battery discharge - decrease by 1% every 20 temperature measurements
    static uint8_t measurement_count = 0;
    measurement_count++;

    if (measurement_count >= 20 && battery_level > 0)
    {
        battery_level--;
        measurement_count = 0;

        // Send battery level update if connected
        if (current_conidx != GAP_INVALID_CONIDX)
        {
            app_batt_set_level(battery_level);
        }
    }
}

/**
 ****************************************************************************************
 * @brief Function called when BLE is powered and ready to sleep.
 * @return GOTO_SLEEP to allow the device to enter sleep mode
 ****************************************************************************************
 */
arch_main_loop_callback_ret_t user_on_ble_powered(void)
{
    // Always return GOTO_SLEEP to allow the device to enter extended sleep mode
    // The device will wake up for:
    // - BLE events (advertising, connection events)
    // - Timer1 interrupts (temperature measurements)
    // - Button presses (if configured)
    return GOTO_SLEEP;
}

/**
 ****************************************************************************************
 * @brief Handles the messages that are not handled by the SDK internal mechanisms.
 * @param[in] msgid   Id of the message received.
 * @param[in] param   Pointer to the parameters of the message.
 * @param[in] dest_id ID of the receiving task instance.
 * @param[in] src_id  ID of the sending task instance.
 ****************************************************************************************
 */
void user_catch_rest_hndl(ke_msg_id_t const msgid,
                          void const *param,
                          ke_task_id_t const dest_id,
                          ke_task_id_t const src_id)
{
    // arch_printf("DEBUG: user_catch_rest_hndl called with msgid=0x%04X, dest_id=0x%04X, src_id=0x%04X\n",
    //             msgid, dest_id, src_id);

    switch(msgid)
    {
        default:
            // Handle battery service messages
            if (app_bass_process_handler(msgid, param, dest_id, src_id, NULL) == PR_EVENT_HANDLED)
            {
                return;
            }
            // Let the SDK handle all messages through the standard callback mechanism
            break;
    }
}

/// @} APP
