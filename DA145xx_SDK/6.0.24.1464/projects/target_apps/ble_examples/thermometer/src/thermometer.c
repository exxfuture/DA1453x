/**
 ****************************************************************************************
 *
 * @file thermometer.c
 *
 * @brief BLE Thermometer application logic.
 *
 * Implements a Health Thermometer Profile (HTP) BLE peripheral.
 *
 * State machine:
 *   Power on  -> start undirected connectable advertising (pairing mode)
 *   Pairing mode:
 *     - LED blinks 1 s on / 1 s off (100 timer units per toggle)
 *     - Advertising stops after user_default_hnd_conf.advertise_period (1 min);
 *       button press or power-cycle restarts it
 *   Connected:
 *     - LED solid on
 *     - When collector enables HTP indications, temperature timer starts
 *     - Temperature is read from AHT20 via I2C and sent every INTERVAL seconds
 *     - Button press -> disconnect and return to pairing mode
 *   Disconnected:
 *     - LED off
 *     - Restart advertising automatically
 *
 * Power management:
 *   - Extended sleep (ARCH_EXT_SLEEP_ON) is always active
 *   - The CPU sleeps between BLE events and timer callbacks
 *   - I2C is initialised and released around each reading to save power
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

/**
 ****************************************************************************************
 * @addtogroup APP
 * @{
 ****************************************************************************************
 */

#include "rwip_config.h"
#include "gattc_task.h"
#include "gapc_task.h"
#include "gapm_task.h"
#include "user_periph_setup.h"
#include "wkupct_quadec.h"
#include "app_easy_msg_utils.h"
#include "gpio.h"
#include "app_security.h"
#include "thermometer.h"
#include "arch.h"
#include "arch_api.h"
#include "app_task.h"
#include "app_htpt.h"
#include "htpt_task.h"
#include "htp_common.h"
#include "app_bass.h"
#include "app_bass_task.h"
#include "app_entry_point.h"
#include "arch_console.h"
#include "ke_msg.h"
#include "user_profiles_config.h"
#include "app_easy_timer.h"
#include "app_default_handlers.h"
#include "i2c_temp_sensor.h"

#if defined (__DA14531__)
#include "timer1.h"
#endif

/*
 * TYPE DEFINITIONS
 ****************************************************************************************
 */

/// Application state
typedef enum
{
    APP_STATE_ADVERTISING = 0,  ///< Connectable advertising, LED blinking
    APP_STATE_CONNECTED,        ///< Connected to collector, LED solid on
} therm_state_t;

/*
 * GLOBAL VARIABLE DEFINITIONS
 ****************************************************************************************
 */

/// Current application state
static therm_state_t therm_state = APP_STATE_ADVERTISING;

/// Active BLE connection index (GAP_INVALID_CONIDX when not connected)
static uint8_t current_conidx = GAP_INVALID_CONIDX;

/// Whether the collector has enabled HTP temperature indications
static bool indications_enabled = false;

/// Timer handle for periodic temperature measurements (fires -> triggers AHT20)
static timer_hnd temp_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle for the AHT20 conversion window.
static timer_hnd aht20_read_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle used to bounce the measurement result to the BLE event loop.
static timer_hnd send_ind_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle for LED blink while advertising
static timer_hnd led_blink_timer = EASY_TIMER_INVALID_TIMER;

/// Pending measurement result (written from I2C ISR, read in BLE event loop).
static int16_t s_pending_temp_x100;
static bool    s_measurement_pending;

/// Current LED state used by the blink routine
static bool led_state = false;

/// Measurement interval in 10 ms ticks (app_easy_timer units)
static uint32_t temp_interval_ticks =
    (uint32_t)(TEMP_MEAS_INTERVAL_DEFAULT_SEC) * 100UL;

/*
 * FORWARD DECLARATIONS
 ****************************************************************************************
 */

static void temp_timer_cb(void);
static void aht20_read_cb(void);
static void send_indication_cb(void);
static void on_trigger_done(bool triggered);
static void on_read_done(bool success, int16_t temp_x100, uint16_t humi_x100);
static void led_blink_cb(void);
static void start_led_blink(void);
static void stop_led_blink(void);
static void led_set(bool on);

/*
 * LED CONTROL
 ****************************************************************************************
 */

static void led_set(bool on)
{
    if (on)
    {
        GPIO_SetActive(GPIO_LED_PORT, GPIO_LED_PIN);
    }
    else
    {
        GPIO_SetInactive(GPIO_LED_PORT, GPIO_LED_PIN);
    }
    led_state = on;
}

static void led_blink_cb(void)
{
    led_blink_timer = EASY_TIMER_INVALID_TIMER;

    if (therm_state != APP_STATE_ADVERTISING)
    {
        return;
    }

    led_set(!led_state);

    /* Reschedule: 100 ticks = 1000 ms */
    led_blink_timer = app_easy_timer(100, led_blink_cb);
}

static void start_led_blink(void)
{
    stop_led_blink();
    led_set(true);
    led_blink_timer = app_easy_timer(100, led_blink_cb);
}

static void stop_led_blink(void)
{
    if (led_blink_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(led_blink_timer);
        led_blink_timer = EASY_TIMER_INVALID_TIMER;
    }
    led_set(false);
}

/*
 * TEMPERATURE MEASUREMENT
 ****************************************************************************************
 *
 * All I2C operations are fully async (interrupt-driven).  The flow is:
 *
 *   temp_timer_cb  -- BLE event loop
 *       |
 *       v  i2c_temp_sensor_trigger(on_trigger_done)   [returns immediately]
 *       |
 *   on_trigger_done  -- I2C ISR context
 *       |  app_easy_timer(AHT20_CONVERSION_MS/10, aht20_read_cb)  [IRQ-safe]
 *       |
 *   aht20_read_cb  -- BLE event loop
 *       |
 *       v  i2c_temp_sensor_read(on_read_done)          [returns immediately]
 *       |
 *   on_read_done  -- I2C ISR context
 *       |  stores result; app_easy_timer(1, send_indication_cb)   [IRQ-safe]
 *       |
 *   send_indication_cb  -- BLE event loop
 *       |  app_htpt_send_measurement(...)              [safe here]
 *
 * The CPU never blocks.  If the I2C bus is stuck or the sensor is absent the
 * async layer detects the abort (TX_ABORT IRQ) and calls back with false,
 * leaving the BLE stack and button fully operational.
 ****************************************************************************************
 */

/*
 * I2C ISR callback — fires when the trigger phase completes.
 * Called from interrupt context: only IRQ-safe SDK calls allowed.
 */
static void on_trigger_done(bool triggered)
{
    if (!triggered || current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;
    }

    /* Start the conversion wait window -- app_easy_timer is IRQ-safe.
     * Skip if a previous conversion window is still open so the handle of a
     * live timer is never overwritten (would leak a timer pool slot). */
    if (aht20_read_timer == EASY_TIMER_INVALID_TIMER)
    {
        aht20_read_timer = app_easy_timer((AHT20_CONVERSION_MS / 10), aht20_read_cb);
    }
}

/* BLE event loop callback — fires AHT20_CONVERSION_MS after the trigger */
static void aht20_read_cb(void)
{
    aht20_read_timer = EASY_TIMER_INVALID_TIMER;

    if (current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;
    }

    /* Start async read -- returns immediately; on_read_done called from ISR */
    i2c_temp_sensor_read(on_read_done);
}

/*
 * I2C ISR callback — fires when the read phase completes.
 * Store the result and bounce to the BLE event loop for the BLE call.
 */
static void on_read_done(bool success, int16_t temp_x100, uint16_t humi_x100)
{
    (void)humi_x100;

    if (!success || current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;
    }

    s_pending_temp_x100  = temp_x100;
    s_measurement_pending = true;

    /* Post to BLE event loop -- app_easy_timer(ke_timer_set) is IRQ-safe */
    if (send_ind_timer == EASY_TIMER_INVALID_TIMER)
    {
        send_ind_timer = app_easy_timer(1, send_indication_cb);
    }
}

/* BLE event loop callback — sends the HTP indication safely */
static void send_indication_cb(void)
{
    send_ind_timer = EASY_TIMER_INVALID_TIMER;

    if (!s_measurement_pending || !indications_enabled ||
        current_conidx == GAP_INVALID_CONIDX)
    {
        s_measurement_pending = false;
        return;
    }

    s_measurement_pending = false;

    /*
     * Encode as IEEE-11073 FLOAT (required by HTP profile):
     *   bits[31:24] = exponent (signed 8-bit)
     *   bits[23:0]  = mantissa (signed 24-bit)
     *   value = mantissa x 10^exponent  (degrees Celsius)
     *
     * CFG_TEMP_RAW_CELSIUS: exponent=0, mantissa=integer °C.
     *   The Renesas SmartBond iOS app ignores the exponent and reads the
     *   mantissa directly as °C -- this encoding makes SmartBond display
     *   the correct (integer) temperature.  Resolution: 1 °C.
     *
     * Default: exponent=-2, mantissa=temp_x100.
     *   Standards-compliant 0.01 °C resolution.  Decoded correctly by any
     *   HTP collector that applies the exponent (e.g. the Angular FE app).
     *   SmartBond will show temp_x100 (e.g. 2715) rather than 27.15.
     */
#if defined(CFG_TEMP_RAW_CELSIUS)
    /* Round temp_x100 to nearest integer degree */
    int32_t temp_rounded = ((int32_t)s_pending_temp_x100 >= 0)
                         ? ((int32_t)s_pending_temp_x100 + 50) / 100
                         : ((int32_t)s_pending_temp_x100 - 50) / 100;
    uint32_t ieee_float = (0x00UL << 24)                                    /* exponent = 0 */
                        | ((uint32_t)(temp_rounded & 0x00FFFFFF));          /* mantissa = °C */
#else
    uint32_t ieee_float = ((uint32_t)(uint8_t)(-2) << 24)                  /* exponent = -2 */
                        | ((uint32_t)((int32_t)s_pending_temp_x100 & 0x00FFFFFF)); /* mantissa = temp×100 */
#endif

    struct htp_temp_meas meas;
    meas.temp  = ieee_float;
    meas.flags = HTP_FLAG_CELSIUS;
    meas.type  = HTP_TYPE_BODY;

    app_htpt_send_measurement(current_conidx, true, &meas);
}

/* BLE event loop callback — fires every temp_interval_ticks to kick a measurement */
static void temp_timer_cb(void)
{
    temp_timer = EASY_TIMER_INVALID_TIMER;

    if (current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;
    }

    /* Start async trigger -- returns immediately; on_trigger_done called from ISR */
    i2c_temp_sensor_trigger(on_trigger_done);

    /* Schedule the next measurement cycle regardless of trigger outcome */
    temp_timer = app_easy_timer(temp_interval_ticks, temp_timer_cb);
}

static void start_temp_timer(void)
{
    if (temp_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(temp_timer);
    }
    temp_timer = app_easy_timer(temp_interval_ticks, temp_timer_cb);
}

static void stop_temp_timer(void)
{
    if (temp_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(temp_timer);
        temp_timer = EASY_TIMER_INVALID_TIMER;
    }
    if (aht20_read_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(aht20_read_timer);
        aht20_read_timer = EASY_TIMER_INVALID_TIMER;
    }
    if (send_ind_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(send_ind_timer);
        send_ind_timer = EASY_TIMER_INVALID_TIMER;
    }
    s_measurement_pending = false;
}

/*
 * BUTTON HANDLING
 ****************************************************************************************
 */

/* Main-loop callback, invoked via app_easy_wakeup() after a button press.
 * BLE API calls (disconnect) must be made here, not in the WKUPCT ISR. */
static void app_button_wakeup_cb(void)
{
    if (therm_state == APP_STATE_CONNECTED && current_conidx != GAP_INVALID_CONIDX)
    {
        app_easy_gap_disconnect(current_conidx);
    }
}

/* WKUPCT ISR callback -- fires on the button press edge.  The wakeup IRQ is
 * one-shot; periph_init() (always executed on DA1453x) re-arms it through
 * app_button_enable(). */
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
    }

    /* Bounce to the BLE event loop for the disconnect action */
    app_easy_wakeup();
}

void app_button_enable(void)
{
    app_easy_wakeup_set(app_button_wakeup_cb);
    wkupct_register_callback(app_button_press_cb);
    wkupct_enable_irq(WKUPCT_PIN_SELECT(GPIO_BUTTON_PORT, GPIO_BUTTON_PIN),
                      WKUPCT_PIN_POLARITY(GPIO_BUTTON_PORT, GPIO_BUTTON_PIN,
                                          WKUPCT_PIN_POLARITY_LOW),
                      1,     /* 1 event */
                      40);   /* debounce time in ms */
}

/*
 * HTPT PROFILE CALLBACKS
 ****************************************************************************************
 */

void user_htpt_ind_cfg_ind(uint8_t conidx, bool ind_en)
{
    indications_enabled = ind_en;

    if (ind_en)
    {
        start_temp_timer();
    }
    else
    {
        stop_temp_timer();
    }
}

void user_htpt_send_measurement_cfm(uint8_t conidx, uint8_t status)
{
    (void)conidx;
    (void)status;
}

void user_htpt_meas_intv_chg_cfm(uint8_t conidx, uint16_t intv)
{
    if (intv >= APP_HTPT_VALID_RANGE_MIN && intv <= APP_HTPT_VALID_RANGE_MAX)
    {
        temp_interval_ticks = (uint32_t)intv * 100UL;

        if (indications_enabled && current_conidx != GAP_INVALID_CONIDX)
        {
            start_temp_timer();
        }

        app_htpt_send_measurement_interval_chg_cfm(conidx, GAP_ERR_NO_ERROR);
    }
    else
    {
        app_htpt_send_measurement_interval_chg_cfm(conidx, HTP_OUT_OF_RANGE_ERR_CODE);
    }
}

/*
 * ADVERTISING COMPLETE
 ****************************************************************************************
 */

void app_advertise_complete(const uint8_t status)
{
    if (status == GAP_ERR_CANCELED)
    {
        /* Advertising timed out.  Turn the LED off and cancel the blink timer
         * so the LED pad is not latched high for the whole deep sleep. */
        stop_led_blink();

        /* Configure the wakeup controller for the button (P0_11) before
         * entering deep sleep, so a button press can wake the system. */
        app_button_enable();

        /* Enter deep sleep with all RAM blocks powered off -- no state needs
         * to be retained since the system performs a full reboot on wakeup.
         * Pad states are latched (pad_latch_en=true) so the button pull-up
         * remains active and can trigger the wakeup controller.
         * On wakeup the device reboots and starts advertising automatically. */
        arch_set_deep_sleep(PD_SYS_DOWN_RAM_OFF,
                            PD_SYS_DOWN_RAM_OFF,
                            PD_SYS_DOWN_RAM_OFF,
                            true);
    }
}

/*
 * APP LIFECYCLE CALLBACKS
 ****************************************************************************************
 */

void user_app_on_init(void)
{
    default_app_on_init();

    current_conidx        = GAP_INVALID_CONIDX;
    indications_enabled   = false;
    temp_timer            = EASY_TIMER_INVALID_TIMER;
    aht20_read_timer      = EASY_TIMER_INVALID_TIMER;
    send_ind_timer        = EASY_TIMER_INVALID_TIMER;
    led_blink_timer       = EASY_TIMER_INVALID_TIMER;
    therm_state           = APP_STATE_ADVERTISING;
    temp_interval_ticks   = (uint32_t)(TEMP_MEAS_INTERVAL_DEFAULT_SEC) * 100UL;
    s_measurement_pending = false;
    s_pending_temp_x100   = 0;
}

void user_app_on_db_init_complete(void)
{
    default_app_on_db_init_complete();

    app_htpt_create_db();
    app_batt_init();
    app_bass_create_db();

    therm_state = APP_STATE_ADVERTISING;
    start_led_blink();
}

void user_app_on_connection(uint8_t conidx, struct gapc_connection_req_ind const *param)
{
    default_app_on_connection(conidx, param);

    current_conidx = conidx;
    therm_state    = APP_STATE_CONNECTED;

    stop_led_blink();
    led_set(true);

    app_htpt_enable(conidx);
    app_bass_enable(conidx);

    arch_set_sleep_mode(ARCH_EXT_SLEEP_ON);
}

void user_app_on_disconnect(struct gapc_disconnect_ind const *param)
{
    stop_temp_timer();
    indications_enabled = false;
    current_conidx      = GAP_INVALID_CONIDX;

    led_set(false);

    therm_state = APP_STATE_ADVERTISING;
    start_led_blink();

    default_app_on_disconnect(param);
}

/*
 * MESSAGE CATCH-ALL
 ****************************************************************************************
 */

void user_catch_rest_hndl(ke_msg_id_t const msgid,
                           void const *param,
                           ke_task_id_t const dest_id,
                           ke_task_id_t const src_id)
{
    if (app_bass_process_handler(msgid, param, dest_id, src_id, NULL) == PR_EVENT_HANDLED)
    {
        return;
    }
}

/// @} APP
