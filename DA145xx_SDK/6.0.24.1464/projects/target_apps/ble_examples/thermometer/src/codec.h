/**
 ****************************************************************************************
 *
 * @file codec.h
 *
 * @brief Pure data-codec functions for the BLE thermometer.
 *
 * Everything in this header is a side-effect-free function of its inputs:
 * AHT20 CRC-8 and frame decoding, IEEE 11073-20601 FLOAT encoding, and
 * multi-sample aggregation.  No SDK dependencies — the same header compiles
 * on the target (GCC arm-none-eabi) and on the host for the unit tests in
 * ../tests/.
 *
 * Copyright (C) 2015-2026 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#ifndef _THERM_CODEC_H_
#define _THERM_CODEC_H_

#include <stdint.h>
#include <stdbool.h>

/// AHT20 status-byte flags
#define AHT20_STATUS_BUSY       (0x80)
#define AHT20_STATUS_CALIBRATED (0x08)

/// One decoded AHT20 sample
typedef struct
{
    int16_t  temp_x100;   ///< Temperature in 0.01 degC units
    uint16_t humi_x100;   ///< Relative humidity in 0.01 % units
} aht20_sample_t;

/**
 * AHT20 CRC-8: polynomial x^8 + x^5 + x^4 + 1 (0x31), init 0xFF, MSB first.
 * The sensor computes it over the status byte and the 5 data bytes.
 */
static inline uint8_t aht20_crc8(const uint8_t *data, uint8_t len)
{
    uint8_t crc = 0xFF;

    for (uint8_t i = 0; i < len; i++)
    {
        crc ^= data[i];
        for (uint8_t bit = 0; bit < 8; bit++)
        {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31)
                               : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

/**
 * Decode a 7-byte AHT20 frame (status + 5 data bytes + CRC).
 * Returns false if the sensor is still busy or the CRC does not match.
 */
static inline bool aht20_decode(const uint8_t frame[7], aht20_sample_t *out)
{
    if (frame[0] & AHT20_STATUS_BUSY)
    {
        return false;
    }

    if (aht20_crc8(frame, 6) != frame[6])
    {
        return false;
    }

    uint32_t raw_hum  = ((uint32_t)frame[1] << 12)
                      | ((uint32_t)frame[2] <<  4)
                      | ((uint32_t)frame[3] >>  4);

    uint32_t raw_temp = ((uint32_t)(frame[3] & 0x0F) << 16)
                      | ((uint32_t)frame[4] <<  8)
                      |  (uint32_t)frame[5];

    /* raw_temp * 20000 / 1048576 == raw_temp * 625 / 32768
     * Use the reduced fraction to stay within 32-bit range:
     * max raw_temp (2^20-1) * 625 = 655,359,375 which fits in uint32_t. */
    out->temp_x100 = (int16_t)((int32_t)((raw_temp * 625UL) / 32768UL) - 5000);

    uint32_t h     = (raw_hum * 10000UL) / 1048576UL;
    out->humi_x100 = (uint16_t)(h > 10000UL ? 10000UL : h);

    return true;
}

/**
 * Encode a temperature as an IEEE 11073-20601 FLOAT:
 *   bits[31:24] = exponent (signed 8-bit), bits[23:0] = mantissa (signed 24-bit)
 *   value = mantissa x 10^exponent (degrees Celsius)
 *
 * raw_celsius=false: exponent -2, mantissa temp_x100 (0.01 degC resolution).
 * raw_celsius=true : exponent 0, mantissa rounded integer degC (SmartBond
 *                    iOS app compatibility — it ignores the exponent).
 */
static inline uint32_t ieee11073_encode_temp(int16_t temp_x100, bool raw_celsius)
{
    if (raw_celsius)
    {
        int32_t temp_rounded = ((int32_t)temp_x100 >= 0)
                             ? ((int32_t)temp_x100 + 50) / 100
                             : ((int32_t)temp_x100 - 50) / 100;
        return (0x00UL << 24) | ((uint32_t)(temp_rounded & 0x00FFFFFF));
    }

    return ((uint32_t)(uint8_t)(-2) << 24)
         | ((uint32_t)((int32_t)temp_x100 & 0x00FFFFFF));
}

/// Median of three values
static inline int16_t median3_i16(int16_t a, int16_t b, int16_t c)
{
    int16_t max_ab = (a > b) ? a : b;
    int16_t min_ab = (a < b) ? a : b;
    int16_t clamped = (c < min_ab) ? min_ab : ((c > max_ab) ? max_ab : c);
    return clamped;
}

/**
 * Aggregate 1..3 temperature samples collected in one measurement cycle:
 * 3 -> median, 2 -> mean, 1 -> the sample itself.  n must be 1..3.
 */
static inline int16_t aggregate_samples_i16(const int16_t *samples, uint8_t n)
{
    if (n >= 3)
    {
        return median3_i16(samples[0], samples[1], samples[2]);
    }
    if (n == 2)
    {
        return (int16_t)(((int32_t)samples[0] + (int32_t)samples[1]) / 2);
    }
    return samples[0];
}

/// Add a calibration offset with int16 saturation
static inline int16_t apply_offset_i16(int16_t temp_x100, int16_t offset_x100)
{
    int32_t v = (int32_t)temp_x100 + (int32_t)offset_x100;
    if (v > INT16_MAX) v = INT16_MAX;
    if (v < INT16_MIN) v = INT16_MIN;
    return (int16_t)v;
}

#endif // _THERM_CODEC_H_
