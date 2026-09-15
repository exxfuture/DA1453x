/**
 ****************************************************************************************
 *
 * @file i2c_temp_sensor.c
 *
 * @brief AHT20 I2C driver -- fully async, interrupt-driven implementation.
 *
 * All I2C operations use the SDK's _async API (interrupt-driven, no polling loops).
 * The CPU never spins waiting for the bus; the BLE stack remains fully responsive
 * even if the sensor is absent or the bus is stuck.
 *
 * Measurement sequence
 * --------------------
 *  Trigger phase  (i2c_temp_sensor_trigger):
 *    1. Read 1 status byte from AHT20 (async).
 *    2a. If CALIBRATED bit is set  -> send 3-byte trigger command (async)
 *        -> callback: cb(true)   [conversion started]
 *    2b. If CALIBRATED bit is clear -> send 3-byte init command (async)
 *        -> callback: cb(false)  [skip this cycle; calibrated on next]
 *    3.  On any I2C error          -> callback: cb(false)
 *
 *  Read phase  (i2c_temp_sensor_read):
 *    1. Read 7 bytes from AHT20 (async): status + 5 data bytes + CRC.
 *    2. Verify the CRC-8 over the first 6 bytes.
 *    3. Decode temperature and humidity.
 *    4. callback: cb(success, temp_x100, humi_x100)
 *
 * Callbacks fire from I2C ISR context.  Only IRQ-safe SDK calls are made from
 * within this file (none -- we just fire the user callback and let the caller
 * decide).
 *
 * A volatile busy flag is raised for the lifetime of every transaction
 * (i2c_temp_sensor_busy()) so that set_pad_functions() — which the SDK's
 * wake-up boilerplate runs from the button ISR — leaves the SCL/SDA pads
 * alone while a transfer is in flight.
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#include "i2c_temp_sensor.h"
#include "i2c.h"
#include "user_periph_setup.h"
#include "codec.h"

/*
 * AHT20 command bytes (status flags live in codec.h)
 */
#define AHT20_CMD_INIT          (0xBE)
#define AHT20_CMD_TRIGGER       (0xAC)
#define AHT20_CMD_SOFT_RESET    (0xBA)

/*
 * Static I2C buffers -- must remain valid for the lifetime of an async transfer.
 */
static uint8_t s_status_buf;        ///< 1-byte status read buffer
static uint8_t s_cmd_buf[3];        ///< 3-byte command write buffer
static uint8_t s_rx_buf[7];         ///< status + 5 data bytes + CRC read buffer

/*
 * Saved application callbacks.
 */
static i2c_temp_trig_cb_t s_trig_cb;
static i2c_temp_read_cb_t s_read_cb;

/*
 * True from the moment a transaction is started until its terminal ISR
 * callback runs.  Written from both task context (start) and I2C ISR context
 * (completion), read from the button ISR via set_pad_functions() — hence
 * volatile.
 */
static volatile bool s_busy;

bool i2c_temp_sensor_busy(void)
{
    return s_busy;
}

/*
 * Forward declarations of internal ISR callbacks.
 */
static void on_status_read(void *cb_data, uint16_t len, bool success);
static void on_init_sent  (void *cb_data, uint16_t len, bool success);
static void on_trigger_sent(void *cb_data, uint16_t len, bool success);
static void on_data_read  (void *cb_data, uint16_t len, bool success);
static void on_reset_sent (void *cb_data, uint16_t len, bool success);

/*
 * ─── I2C CONFIGURATION ──────────────────────────────────────────────────────
 */

static void build_i2c_cfg(i2c_cfg_t *cfg)
{
    cfg->clock_cfg.ss_hcnt = I2C_SS_SCL_HCNT_REG_RESET;
    cfg->clock_cfg.ss_lcnt = I2C_SS_SCL_LCNT_REG_RESET;
    cfg->clock_cfg.fs_hcnt = I2C_FS_SCL_HCNT_REG_RESET;
    cfg->clock_cfg.fs_lcnt = I2C_FS_SCL_LCNT_REG_RESET;
    cfg->restart_en        = I2C_RESTART_ENABLE;
    cfg->speed             = I2C_SPEED_MODE;      /* user_periph_setup.h */
    cfg->mode              = I2C_MODE_MASTER;
    cfg->addr_mode         = I2C_ADDRESS_MODE;    /* user_periph_setup.h */
    cfg->address           = AHT20_I2C_ADDRESS;   /* fixed by the sensor */
    cfg->tx_fifo_level     = 1;
    cfg->rx_fifo_level     = 1;
}

/*
 * ─── TRIGGER PHASE ──────────────────────────────────────────────────────────
 */

void i2c_temp_sensor_trigger(i2c_temp_trig_cb_t cb)
{
    i2c_cfg_t cfg;

    s_trig_cb = cb;
    s_busy    = true;

    build_i2c_cfg(&cfg);
    i2c_init(&cfg);

    /* Phase 1: read status byte to check calibration flag */
    i2c_master_receive_buffer_async(&s_status_buf, 1,
                                    on_status_read, NULL, 0);
}

/* Called from I2C ISR when the 1-byte status read completes */
static void on_status_read(void *cb_data, uint16_t len, bool success)
{
    (void)cb_data;

    if (!success || len != 1)
    {
        i2c_release();
        s_busy = false;
        if (s_trig_cb) s_trig_cb(false);
        return;
    }

    if (!(s_status_buf & AHT20_STATUS_CALIBRATED))
    {
        /* Sensor is not yet calibrated -- send the one-time init command.
         * We return false this cycle so the caller skips the read phase.
         * The sensor will be calibrated by the next trigger. */
        s_cmd_buf[0] = AHT20_CMD_INIT;
        s_cmd_buf[1] = 0x08;
        s_cmd_buf[2] = 0x00;
        i2c_master_transmit_buffer_async(s_cmd_buf, 3,
                                         on_init_sent, NULL,
                                         I2C_F_WAIT_FOR_STOP);
        return;
    }

    /* Sensor is calibrated -- send the measurement trigger command */
    s_cmd_buf[0] = AHT20_CMD_TRIGGER;
    s_cmd_buf[1] = 0x33;
    s_cmd_buf[2] = 0x00;
    i2c_master_transmit_buffer_async(s_cmd_buf, 3,
                                     on_trigger_sent, NULL,
                                     I2C_F_WAIT_FOR_STOP);
}

/* Called from I2C ISR when the init command write completes */
static void on_init_sent(void *cb_data, uint16_t len, bool success)
{
    (void)cb_data;
    (void)len;
    (void)success;

    i2c_release();
    s_busy = false;
    /* Skip this cycle; next trigger will find the sensor calibrated */
    if (s_trig_cb) s_trig_cb(false);
}

/* Called from I2C ISR when the trigger command write completes */
static void on_trigger_sent(void *cb_data, uint16_t len, bool success)
{
    (void)cb_data;

    i2c_release();
    s_busy = false;
    if (s_trig_cb) s_trig_cb(success && (len == 3));
}

/*
 * ─── READ PHASE ─────────────────────────────────────────────────────────────
 */

void i2c_temp_sensor_read(i2c_temp_read_cb_t cb)
{
    i2c_cfg_t cfg;

    s_read_cb = cb;
    s_busy    = true;

    build_i2c_cfg(&cfg);
    i2c_init(&cfg);

    i2c_master_receive_buffer_async(s_rx_buf, 7,
                                    on_data_read, NULL, 0);
}

/* Called from I2C ISR when the 7-byte data read completes */
static void on_data_read(void *cb_data, uint16_t len, bool success)
{
    aht20_sample_t sample;

    (void)cb_data;

    i2c_release();
    s_busy = false;

    if (!success || len != 7 || !aht20_decode(s_rx_buf, &sample))
    {
        /* Transfer failed, sensor still busy, or CRC mismatch */
        if (s_read_cb) s_read_cb(false, 0, 0);
        return;
    }

    if (s_read_cb) s_read_cb(true, sample.temp_x100, sample.humi_x100);
}

/*
 * ─── SOFT RESET ─────────────────────────────────────────────────────────────
 */

void i2c_temp_sensor_soft_reset(void)
{
    i2c_cfg_t cfg;

    s_busy = true;

    build_i2c_cfg(&cfg);
    i2c_init(&cfg);

    /* Single-byte soft reset command; sensor restarts within 20 ms and
     * re-runs its power-on calibration. */
    s_cmd_buf[0] = AHT20_CMD_SOFT_RESET;
    i2c_master_transmit_buffer_async(s_cmd_buf, 1,
                                     on_reset_sent, NULL,
                                     I2C_F_WAIT_FOR_STOP);
}

/* Called from I2C ISR when the soft reset write completes (or aborts) */
static void on_reset_sent(void *cb_data, uint16_t len, bool success)
{
    (void)cb_data;
    (void)len;
    (void)success;

    i2c_release();
    s_busy = false;
}
