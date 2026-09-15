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
 *     - LED flashes 50 ms every 2 s (short duty cycle to save battery)
 *     - Advertising stops after user_default_hnd_conf.advertise_period (1 min);
 *       button press or power-cycle restarts it
 *   Connected:
 *     - LED solid on
 *     - When collector enables HTP indications, temperature timer starts
 *     - Each cycle takes up to TEMP_SAMPLES_PER_MEASUREMENT AHT20 readings
 *       100 ms apart and sends the median (3), mean (2) or single value,
 *       plus CFG_TEMP_OFFSET_X100, every INTERVAL seconds
 *     - After AHT20_FAILS_BEFORE_SOFT_RESET consecutive dead cycles the AHT20
 *       is soft-reset; after AHT20_FAILS_BEFORE_BUS_RECOVERY the I2C bus is
 *       manually recovered first (repeats every 5 further failures)
 *     - Button press -> disconnect and return to pairing mode
 *   Disconnected:
 *     - LED off
 *     - Restart advertising automatically
 *
 * Link security:
 *   - The HTP service is created with SRV_PERM_UNAUTH, so its characteristics
 *     (temperature indications, interval) are only reachable over an
 *     encrypted link, and the default handlers send a security request on
 *     every connection (DEF_SEC_REQ_ON_CONNECT).  Pairing is Just Works
 *     without bonding: each connection re-pairs, nothing persists, and a
 *     passive sniffer never sees plaintext measurements.
 *
 * Concurrency:
 *   - The AHT20 driver completes in I2C interrupt context; everything it
 *     touches that the BLE task context also reads or writes is declared
 *     volatile, and the cycle is torn down (guards cleared, then timers
 *     cancelled) inside a critical section so a late ISR callback can never
 *     re-arm a timer that was just cancelled.
 *   - The "what next" decisions of the cycle (cycle_next_action,
 *     recovery_action) are pure functions in codec.h with host tests.
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
#include "codec.h"
#include "ll.h"
#include "app_prf_perm_types.h"

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

/*
 * Everything below marked volatile is shared between the BLE task context
 * (timer callbacks, profile callbacks) and the I2C interrupt context
 * (on_trigger_done / on_read_done -> handle_sample_done).  build.sh compiles
 * with -flto -Os, which gives the compiler whole-program visibility, so
 * without volatile it may legitimately cache or reorder these accesses.
 */

/// Active BLE connection index (GAP_INVALID_CONIDX when not connected)
static volatile uint8_t current_conidx = GAP_INVALID_CONIDX;

/// Whether the collector has enabled HTP temperature indications
static volatile bool indications_enabled = false;

/// Timer handle for periodic temperature measurements (fires -> triggers AHT20)
static timer_hnd temp_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle for the AHT20 conversion window (armed from the I2C ISR).
static volatile timer_hnd aht20_read_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle used to bounce the measurement result to the BLE event loop
/// (armed from the I2C ISR).
static volatile timer_hnd send_ind_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle for LED blink while advertising
static timer_hnd led_blink_timer = EASY_TIMER_INVALID_TIMER;

/// Timer handle for the gap between samples within one measurement cycle
/// (armed from the I2C ISR).
static volatile timer_hnd sample_gap_timer = EASY_TIMER_INVALID_TIMER;

/// Pending measurement result (written from I2C ISR, read in BLE event loop).
static volatile int16_t s_pending_temp_x100;
static volatile bool    s_measurement_pending;

/// Samples collected in the current measurement cycle (ISR-written)
static volatile int16_t s_samples[TEMP_SAMPLES_PER_MEASUREMENT];
static volatile uint8_t s_sample_count;
static volatile uint8_t s_sample_attempts;

/// Consecutive measurement cycles that yielded zero valid samples
static volatile uint8_t s_consecutive_fail_cycles;

/// HTP indications the stack reported as not delivered (debug counter; the
/// value is also printed via arch_printf when CFG_PRINTF is enabled)
static uint16_t s_indication_failures;

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
static void start_sample(void);
static void sample_gap_cb(void);
static void handle_sample_done(bool ok, int16_t temp_x100);
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

/* 50 ms flash every 2 s: ~2.5 % duty cycle — the LED is the largest single
 * consumer while advertising, so keep it lit as briefly as visibility allows. */
#define LED_BLINK_ON_TICKS   5     /* 50 ms   */
#define LED_BLINK_OFF_TICKS  195   /* 1950 ms */

static void led_blink_cb(void)
{
    led_blink_timer = EASY_TIMER_INVALID_TIMER;

    if (therm_state != APP_STATE_ADVERTISING)
    {
        return;
    }

    led_set(!led_state);

    led_blink_timer = app_easy_timer(led_state ? LED_BLINK_ON_TICKS
                                               : LED_BLINK_OFF_TICKS,
                                     led_blink_cb);
}

static void start_led_blink(void)
{
    stop_led_blink();
    led_set(true);
    led_blink_timer = app_easy_timer(LED_BLINK_ON_TICKS, led_blink_cb);
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
 *       |  handle_sample_done(): cycle_next_action() decides between another
 *       |  sample (app_easy_timer -> sample_gap_cb), a dead cycle, or
 *       |  aggregate + app_easy_timer(1, send_indication_cb)    [IRQ-safe]
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
    if (current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;  /* cycle abandoned (disconnect / unsubscribe) */
    }

    if (!triggered)
    {
        /* Trigger failed (I2C error or sensor still calibrating) */
        handle_sample_done(false, 0);
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
 */
static void on_read_done(bool success, int16_t temp_x100, uint16_t humi_x100)
{
    (void)humi_x100;

    if (current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;  /* cycle abandoned */
    }

    handle_sample_done(success, temp_x100);
}

/*
 * Per-sample completion — called from I2C ISR context (only IRQ-safe SDK
 * calls: counters and app_easy_timer).  Collects up to
 * TEMP_SAMPLES_PER_MEASUREMENT samples 100 ms apart, then aggregates and
 * bounces the result to the BLE event loop.
 */
static void handle_sample_done(bool ok, int16_t temp_x100)
{
    s_sample_attempts++;

    if (ok && s_sample_count < TEMP_SAMPLES_PER_MEASUREMENT)
    {
        s_samples[s_sample_count++] = temp_x100;
    }

    switch (cycle_next_action(s_sample_attempts, s_sample_count,
                              TEMP_SAMPLES_PER_MEASUREMENT))
    {
    case CYCLE_NEXT_SAMPLE:
        if (sample_gap_timer == EASY_TIMER_INVALID_TIMER)
        {
            sample_gap_timer = app_easy_timer(TEMP_SAMPLE_GAP_TICKS, sample_gap_cb);
        }
        return;

    case CYCLE_FAILED:
        if (s_consecutive_fail_cycles < UINT8_MAX)
        {
            s_consecutive_fail_cycles++;
        }
        return;

    case CYCLE_COMPLETE:
    default:
        break;
    }

    /* Snapshot the volatile sample buffer for the pure aggregator (no other
     * writer can run: we are in the ISR that produced the last sample). */
    int16_t samples[TEMP_SAMPLES_PER_MEASUREMENT];
    uint8_t n = s_sample_count;
    for (uint8_t i = 0; i < n; i++)
    {
        samples[i] = s_samples[i];
    }

    s_consecutive_fail_cycles = 0;
    s_pending_temp_x100 = apply_offset_i16(aggregate_samples_i16(samples, n),
                                           CFG_TEMP_OFFSET_X100);
    s_measurement_pending = true;

    /* Post to BLE event loop -- app_easy_timer(ke_timer_set) is IRQ-safe */
    if (send_ind_timer == EASY_TIMER_INVALID_TIMER)
    {
        send_ind_timer = app_easy_timer(1, send_indication_cb);
    }
}

/* BLE event loop callback — starts the next sample of the current cycle */
static void sample_gap_cb(void)
{
    sample_gap_timer = EASY_TIMER_INVALID_TIMER;

    if (current_conidx == GAP_INVALID_CONIDX || !indications_enabled)
    {
        return;
    }

    start_sample();
}

static void start_sample(void)
{
    /* Async trigger -- returns immediately; on_trigger_done runs in ISR */
    i2c_temp_sensor_trigger(on_trigger_done);
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
     * IEEE-11073 FLOAT encoding lives in codec.h.  CFG_TEMP_RAW_CELSIUS
     * selects the SmartBond-compatible integer-degC form (see thermometer.h).
     */
#if defined(CFG_TEMP_RAW_CELSIUS)
    uint32_t ieee_float = ieee11073_encode_temp(s_pending_temp_x100, true);
#else
    uint32_t ieee_float = ieee11073_encode_temp(s_pending_temp_x100, false);
#endif

    /* flags = Celsius, no timestamp, no type byte.  The measurement type
     * (body) is exposed through the separate Temperature Type characteristic
     * (APP_HTPT_TEMP_TYPE / HTPT_TEMP_TYPE_CHAR_SUP, user_profiles_config.h);
     * the SDK only packs meas.type into the indication when HTP_FLAG_TYPE is
     * set, so it is deliberately not assigned here. */
    struct htp_temp_meas meas = {0};
    meas.temp  = ieee_float;
    meas.flags = HTP_FLAG_CELSIUS;

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

    /* Schedule the next measurement cycle regardless of this cycle's outcome */
    temp_timer = app_easy_timer(temp_interval_ticks, temp_timer_cb);

    /* Recovery ladder (recovery_action, codec.h): after
     * AHT20_FAILS_BEFORE_SOFT_RESET consecutive dead cycles soft-reset the
     * AHT20; every AHT20_FAILS_BEFORE_BUS_RECOVERY, manually recover the I2C
     * bus first.  The recovery replaces this cycle's measurement so it never
     * overlaps another I2C transaction. */
    recovery_action_t recovery = recovery_action(s_consecutive_fail_cycles,
                                                 AHT20_FAILS_BEFORE_SOFT_RESET,
                                                 AHT20_FAILS_BEFORE_BUS_RECOVERY);
    if (recovery != RECOVERY_NONE)
    {
        if (recovery == RECOVERY_BUS_AND_SOFT_RESET)
        {
            i2c_bus_recover();
        }
        i2c_temp_sensor_soft_reset();

        if (s_consecutive_fail_cycles < UINT8_MAX)
        {
            s_consecutive_fail_cycles++;  /* count the skipped cycle too */
        }
        return;
    }

    s_sample_count    = 0;
    s_sample_attempts = 0;
    start_sample();
}

static void start_temp_timer(void)
{
    if (temp_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(temp_timer);
    }
    temp_timer = app_easy_timer(temp_interval_ticks, temp_timer_cb);
}

/*
 * Tear down the measurement cycle.  Runs inside a critical section: the
 * I2C ISR callbacks (on_trigger_done / on_read_done -> handle_sample_done)
 * arm aht20_read_timer, sample_gap_timer and send_ind_timer, so an interrupt
 * landing between "cancel" and "clear the handle" — or between clearing the
 * connection guards and cancelling — could otherwise re-arm a timer that was
 * just cleaned up and leak an app_easy_timer pool slot.  Callers must clear
 * indications_enabled / current_conidx BEFORE calling this so that any ISR
 * that does run afterwards sees the cycle as abandoned and returns early.
 */
static void stop_temp_timer(void)
{
    GLOBAL_INT_DISABLE();

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
    if (sample_gap_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(sample_gap_timer);
        sample_gap_timer = EASY_TIMER_INVALID_TIMER;
    }
    s_measurement_pending     = false;
    s_sample_count            = 0;
    s_sample_attempts         = 0;
    s_consecutive_fail_cycles = 0;

    GLOBAL_INT_RESTORE();
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
    (void)conidx;

    /* Guard first, then tear down — see stop_temp_timer() */
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

    if (status != GAP_ERR_NO_ERROR)
    {
        if (s_indication_failures < UINT16_MAX)
        {
            s_indication_failures++;
        }
#if defined (CFG_PRINTF)
        arch_printf("HTP indication failed: status 0x%02x (total %u)\r\n",
                    status, s_indication_failures);
#endif
    }
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
#if defined (__DA14531__)
        arch_set_deep_sleep(PD_SYS_DOWN_RAM_OFF,
                            PD_SYS_DOWN_RAM_OFF,
                            PD_SYS_DOWN_RAM_OFF,
                            true);
#else
        /* DA14585/586: single-argument form — allow the external (button)
         * wake-up interrupt to reboot the system. */
        arch_set_deep_sleep(true);
#endif
    }
}

/*
 * APP LIFECYCLE CALLBACKS
 ****************************************************************************************
 */

void user_app_on_init(void)
{
    default_app_on_init();

    current_conidx            = GAP_INVALID_CONIDX;
    indications_enabled       = false;
    temp_timer                = EASY_TIMER_INVALID_TIMER;
    aht20_read_timer          = EASY_TIMER_INVALID_TIMER;
    send_ind_timer            = EASY_TIMER_INVALID_TIMER;
    led_blink_timer           = EASY_TIMER_INVALID_TIMER;
    sample_gap_timer          = EASY_TIMER_INVALID_TIMER;
    therm_state               = APP_STATE_ADVERTISING;
    temp_interval_ticks       = (uint32_t)(TEMP_MEAS_INTERVAL_DEFAULT_SEC) * 100UL;
    s_measurement_pending     = false;
    s_pending_temp_x100       = 0;
    s_sample_count            = 0;
    s_sample_attempts         = 0;
    s_consecutive_fail_cycles = 0;
    s_indication_failures     = 0;
}

void user_app_on_db_init_complete(void)
{
    default_app_on_db_init_complete();

    /* The HTP characteristics carry the wearer's temperature: require an
     * encrypted link (unauthenticated / Just Works is enough — the threat is
     * passive sniffing, not an active MITM with a display-less device).  A
     * collector that touches them before pairing gets ATT "insufficient
     * encryption"; combined with DEF_SEC_REQ_ON_CONNECT (user_config.h) the
     * link is normally encrypted before service discovery finishes.
     * Battery level and Device Information stay readable without pairing. */
    app_set_prf_srv_perm(TASK_ID_HTPT, SRV_PERM_UNAUTH);

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
    /* Clear the guards every I2C-ISR callback checks BEFORE cancelling the
     * timers, so an interrupt that lands in between sees the cycle as
     * abandoned instead of re-arming a timer we are about to cancel
     * (same order as user_htpt_ind_cfg_ind). */
    indications_enabled = false;
    current_conidx      = GAP_INVALID_CONIDX;
    stop_temp_timer();

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
