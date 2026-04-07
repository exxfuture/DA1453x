/**
 ****************************************************************************************
 *
 * @file i2c_temp_sensor.h
 *
 * @brief AHT20 I2C temperature and humidity sensor driver for the DA14535.
 *
 * The AHT20 is a calibrated, fully compensated digital temperature and humidity
 * sensor with a fixed I2C address of 0x38.
 *
 *   Accuracy:  +/-0.3 C temperature,  +/-2 % RH humidity
 *   Range:     -40 to +85 C,         0 to 100 % RH
 *   Interface: I2C, 400 kHz max
 *
 * Hardware wiring (DA14535-00FXDEVKT-U):
 *
 *   AHT20 pin   Board connection     Notes
 *   ---------   ----------------     -----
 *   VDD         3.3 V (J3 pin 1)     100 nF decoupling cap recommended near VDD
 *   GND         GND  (J3 pin 2)
 *   SCL         P0_7 (J3)            4.7 kOhm pull-up to 3.3 V
 *   SDA         P0_6 (J3)            4.7 kOhm pull-up to 3.3 V
 *
 *   The AHT20 I2C address is fixed at 0x38 -- no address-select pin.
 *
 * Non-blocking (async) usage pattern:
 *
 *   1. Call i2c_temp_sensor_trigger(cb) -- returns immediately; cb fires from I2C ISR.
 *   2. If cb(true), schedule a timer for AHT20_CONVERSION_MS milliseconds.
 *   3. In the timer callback call i2c_temp_sensor_read(cb) -- returns immediately;
 *      cb fires from I2C ISR with the converted temperature and humidity.
 *
 * The callbacks are invoked from interrupt context. Only IRQ-safe SDK functions
 * (ke_timer_set / app_easy_timer, ke_msg_send_basic) may be called from them.
 * For heavier work, bounce back to the BLE event loop via app_easy_timer(1, ...).
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#ifndef _I2C_TEMP_SENSOR_H_
#define _I2C_TEMP_SENSOR_H_

#include <stdint.h>
#include <stdbool.h>

/// AHT20 fixed 7-bit I2C address
#define AHT20_I2C_ADDRESS       (0x38)

/**
 * Minimum time (ms) to wait between calling i2c_temp_sensor_trigger() and
 * i2c_temp_sensor_read().  The AHT20 datasheet specifies 80 ms typical; we
 * use 90 ms to include margin (= 9 x 10 ms app_easy_timer ticks).
 */
#define AHT20_CONVERSION_MS     (90)

/**
 * @brief Callback fired when the trigger phase completes (from I2C ISR).
 *
 * @param triggered  true  -- measurement trigger was sent to AHT20.
 *                   false -- sensor not ready / I2C error (skip this cycle).
 */
typedef void (*i2c_temp_trig_cb_t)(bool triggered);

/**
 * @brief Callback fired when the read phase completes (from I2C ISR).
 *
 * @param success          true if valid data was retrieved.
 * @param temp_celsius_x100  Temperature in 0.01 C units (e.g. 2350 = 23.50 C).
 * @param humidity_x100      Relative humidity in 0.01 % units (e.g. 4500 = 45.00 %).
 */
typedef void (*i2c_temp_read_cb_t)(bool success,
                                   int16_t  temp_celsius_x100,
                                   uint16_t humidity_x100);

/**
 * @brief Start an async AHT20 measurement trigger.
 *
 * Initiates the I2C transaction non-blocking.  The supplied callback is called
 * from the I2C interrupt handler when the transaction completes or fails.
 *
 * @param cb  Completion callback (must not be NULL).
 */
void i2c_temp_sensor_trigger(i2c_temp_trig_cb_t cb);

/**
 * @brief Start an async AHT20 result read.
 *
 * Must be called AHT20_CONVERSION_MS after i2c_temp_sensor_trigger().
 * Initiates the I2C transaction non-blocking.  The supplied callback is called
 * from the I2C interrupt handler when the 6-byte result is received or an
 * error occurs.
 *
 * @param cb  Completion callback (must not be NULL).
 */
void i2c_temp_sensor_read(i2c_temp_read_cb_t cb);

#endif // _I2C_TEMP_SENSOR_H_
