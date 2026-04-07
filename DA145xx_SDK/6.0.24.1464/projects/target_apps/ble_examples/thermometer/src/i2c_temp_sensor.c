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
 *    1. Read 6 data bytes from AHT20 (async).
 *    2. Decode temperature and humidity.
 *    3. callback: cb(success, temp_x100, humi_x100)
 *
 * Callbacks fire from I2C ISR context.  Only IRQ-safe SDK calls are made from
 * within this file (none -- we just fire the user callback and let the caller
 * decide).
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#include "i2c_temp_sensor.h"
#include "i2c.h"
#include "user_periph_setup.h"

/*
 * AHT20 command bytes
 */
#define AHT20_CMD_INIT          (0xBE)
#define AHT20_CMD_TRIGGER       (0xAC)
#define AHT20_STATUS_BUSY       (0x80)
#define AHT20_STATUS_CALIBRATED (0x08)

/*
 * Static I2C buffers -- must remain valid for the lifetime of an async transfer.
 */
static uint8_t s_status_buf;        ///< 1-byte status read buffer
static uint8_t s_cmd_buf[3];        ///< 3-byte command write buffer
static uint8_t s_rx_buf[6];         ///< 6-byte sensor data read buffer

/*
 * Saved application callbacks.
 */
static i2c_temp_trig_cb_t s_trig_cb;
static i2c_temp_read_cb_t s_read_cb;

/*
 * Forward declarations of internal ISR callbacks.
 */
static void on_status_read(void *cb_data, uint16_t len, bool success);
static void on_init_sent  (void *cb_data, uint16_t len, bool success);
static void on_trigger_sent(void *cb_data, uint16_t len, bool success);
static void on_data_read  (void *cb_data, uint16_t len, bool success);

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
    cfg->speed             = I2C_SPEED_FAST;
    cfg->mode              = I2C_MODE_MASTER;
    cfg->addr_mode         = I2C_ADDRESSING_7B;
    cfg->address           = AHT20_I2C_ADDRESS;
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
    /* Skip this cycle; next trigger will find the sensor calibrated */
    if (s_trig_cb) s_trig_cb(false);
}

/* Called from I2C ISR when the trigger command write completes */
static void on_trigger_sent(void *cb_data, uint16_t len, bool success)
{
    (void)cb_data;

    i2c_release();
    if (s_trig_cb) s_trig_cb(success && (len == 3));
}

/*
 * ─── READ PHASE ─────────────────────────────────────────────────────────────
 */

void i2c_temp_sensor_read(i2c_temp_read_cb_t cb)
{
    i2c_cfg_t cfg;

    s_read_cb = cb;

    build_i2c_cfg(&cfg);
    i2c_init(&cfg);

    i2c_master_receive_buffer_async(s_rx_buf, 6,
                                    on_data_read, NULL, 0);
}

/* Called from I2C ISR when the 6-byte data read completes */
static void on_data_read(void *cb_data, uint16_t len, bool success)
{
    (void)cb_data;

    i2c_release();

    if (!success || len != 6)
    {
        if (s_read_cb) s_read_cb(false, 0, 0);
        return;
    }

    if (s_rx_buf[0] & AHT20_STATUS_BUSY)
    {
        /* Conversion not yet complete */
        if (s_read_cb) s_read_cb(false, 0, 0);
        return;
    }

    /* Decode AHT20 raw values */
    uint32_t raw_hum  = ((uint32_t)s_rx_buf[1] << 12)
                      | ((uint32_t)s_rx_buf[2] <<  4)
                      | ((uint32_t)s_rx_buf[3] >>  4);

    uint32_t raw_temp = ((uint32_t)(s_rx_buf[3] & 0x0F) << 16)
                      | ((uint32_t)s_rx_buf[4] <<  8)
                      |  (uint32_t)s_rx_buf[5];

    /* raw_temp * 20000 / 1048576 == raw_temp * 625 / 32768
     * Use the reduced fraction to stay within 32-bit range:
     * max raw_temp (2^20-1) * 625 = 655,359,375 which fits in uint32_t. */
    int16_t  temp_x100 = (int16_t)((int32_t)((raw_temp * 625UL) / 32768UL) - 5000);
    uint32_t h         = (raw_hum * 10000UL) / 1048576UL;
    uint16_t humi_x100 = (uint16_t)(h > 10000UL ? 10000UL : h);

    if (s_read_cb) s_read_cb(true, temp_x100, humi_x100);
}
