/*
 * Host-side unit tests for src/codec.h (pure functions, no SDK dependencies).
 * Build & run: bash tests/run_tests.sh
 */

#include <stdio.h>
#include <string.h>
#include "../src/codec.h"

static int g_failures;

#define CHECK(cond) do { \
    if (!(cond)) { \
        g_failures++; \
        printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    } \
} while (0)

/* Build a 7-byte AHT20 frame from raw 20-bit values, CRC appended */
static void make_frame(uint8_t status, uint32_t raw_hum, uint32_t raw_temp,
                       uint8_t frame[7])
{
    frame[0] = status;
    frame[1] = (uint8_t)(raw_hum >> 12);
    frame[2] = (uint8_t)(raw_hum >> 4);
    frame[3] = (uint8_t)(((raw_hum & 0x0F) << 4) | ((raw_temp >> 16) & 0x0F));
    frame[4] = (uint8_t)(raw_temp >> 8);
    frame[5] = (uint8_t)raw_temp;
    frame[6] = aht20_crc8(frame, 6);
}

static void test_crc8_known_vector(void)
{
    /* CRC-8/NRSC-5 (poly 0x31, init 0xFF, no reflection): check("123456789") = 0xF7 */
    const uint8_t check[9] = {'1','2','3','4','5','6','7','8','9'};
    CHECK(aht20_crc8(check, 9) == 0xF7);
}

static void test_decode_midscale(void)
{
    /* raw = 2^19 = half scale: hum -> 50.00 %, temp -> 200*0.5-50 = 50.00 degC */
    uint8_t frame[7];
    aht20_sample_t s;

    make_frame(AHT20_STATUS_CALIBRATED, 0x80000UL, 0x80000UL, frame);
    CHECK(aht20_decode(frame, &s));
    CHECK(s.temp_x100 == 5000);
    CHECK(s.humi_x100 == 5000);
}

static void test_decode_extremes(void)
{
    uint8_t frame[7];
    aht20_sample_t s;

    /* raw_temp = 0 -> -50.00 degC; raw_hum = 0 -> 0 % */
    make_frame(AHT20_STATUS_CALIBRATED, 0, 0, frame);
    CHECK(aht20_decode(frame, &s));
    CHECK(s.temp_x100 == -5000);
    CHECK(s.humi_x100 == 0);

    /* raw max (2^20 - 1) is one LSB below full scale:
     * temp ~= 149.99 degC, hum = 99.99 % (the 100.00 clamp is unreachable
     * from a 20-bit raw value; it guards against arithmetic drift only) */
    make_frame(AHT20_STATUS_CALIBRATED, 0xFFFFFUL, 0xFFFFFUL, frame);
    CHECK(aht20_decode(frame, &s));
    CHECK(s.temp_x100 > 14990 && s.temp_x100 <= 15000);
    CHECK(s.humi_x100 == 9999);
}

static void test_decode_rejects_busy_and_bad_crc(void)
{
    uint8_t frame[7];
    aht20_sample_t s;

    make_frame(AHT20_STATUS_BUSY | AHT20_STATUS_CALIBRATED, 0x80000UL, 0x80000UL, frame);
    CHECK(!aht20_decode(frame, &s));

    make_frame(AHT20_STATUS_CALIBRATED, 0x80000UL, 0x80000UL, frame);
    frame[6] ^= 0xFF;   /* corrupt the CRC */
    CHECK(!aht20_decode(frame, &s));

    make_frame(AHT20_STATUS_CALIBRATED, 0x80000UL, 0x80000UL, frame);
    frame[4] ^= 0x01;   /* corrupt a data byte */
    CHECK(!aht20_decode(frame, &s));
}

static void test_ieee11073_standard(void)
{
    /* 27.15 degC -> exponent -2 (0xFE), mantissa 2715 (0xA9B) */
    CHECK(ieee11073_encode_temp(2715, false) == 0xFE000A9BUL);
    /* -5.50 degC -> mantissa -550 in 24-bit two's complement = 0xFFFDDA */
    CHECK(ieee11073_encode_temp(-550, false) == 0xFEFFFDDAUL);
    CHECK(ieee11073_encode_temp(0, false) == 0xFE000000UL);
}

static void test_ieee11073_raw_celsius(void)
{
    /* 27.15 -> 27; 27.50 -> 28 (round half away from zero); -5.50 -> -6 */
    CHECK(ieee11073_encode_temp(2715, true) == 0x0000001BUL);
    CHECK(ieee11073_encode_temp(2750, true) == 0x0000001CUL);
    CHECK(ieee11073_encode_temp(-550, true) == 0x00FFFFFAUL);
}

static void test_median3(void)
{
    CHECK(median3_i16(1, 2, 3) == 2);
    CHECK(median3_i16(3, 1, 2) == 2);
    CHECK(median3_i16(2, 3, 1) == 2);
    CHECK(median3_i16(5, 5, 1) == 5);
    CHECK(median3_i16(-10, 0, 10) == 0);
    CHECK(median3_i16(7, 7, 7) == 7);
}

static void test_aggregate(void)
{
    int16_t three[3] = {2500, 2700, 2600};
    int16_t two[2]   = {2500, 2600};
    int16_t one[1]   = {2550};

    CHECK(aggregate_samples_i16(three, 3) == 2600);  /* median */
    CHECK(aggregate_samples_i16(two, 2)   == 2550);  /* mean   */
    CHECK(aggregate_samples_i16(one, 1)   == 2550);
}

static void test_offset(void)
{
    CHECK(apply_offset_i16(2500, -30) == 2470);
    CHECK(apply_offset_i16(2500, 0) == 2500);
    CHECK(apply_offset_i16(32760, 100) == INT16_MAX);   /* saturates */
    CHECK(apply_offset_i16(-32760, -100) == INT16_MIN); /* saturates */
}

int main(void)
{
    test_crc8_known_vector();
    test_decode_midscale();
    test_decode_extremes();
    test_decode_rejects_busy_and_bad_crc();
    test_ieee11073_standard();
    test_ieee11073_raw_celsius();
    test_median3();
    test_aggregate();
    test_offset();

    if (g_failures)
    {
        printf("%d test check(s) FAILED\n", g_failures);
        return 1;
    }
    printf("All codec tests passed.\n");
    return 0;
}
