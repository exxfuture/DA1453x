/*
 * Host-side unit tests for src/codec.h (pure functions, no SDK dependencies):
 * AHT20 CRC-8 / decode, IEEE 11073 encode, aggregation, offset, and the
 * measurement-cycle decision table (cycle_next_action / recovery_action)
 * that thermometer.c's ISR/task state machine is driven by.
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

/* cycle_next_action(): the per-attempt decision table thermometer.c drives
 * handle_sample_done() with (3 samples per cycle). */
static void test_cycle_next_action(void)
{
    /* attempts remaining -> another sample, regardless of how many were valid */
    CHECK(cycle_next_action(1, 1, 3) == CYCLE_NEXT_SAMPLE);
    CHECK(cycle_next_action(1, 0, 3) == CYCLE_NEXT_SAMPLE);
    CHECK(cycle_next_action(2, 0, 3) == CYCLE_NEXT_SAMPLE);
    CHECK(cycle_next_action(2, 2, 3) == CYCLE_NEXT_SAMPLE);

    /* last attempt done: at least one valid sample -> send, none -> dead cycle */
    CHECK(cycle_next_action(3, 3, 3) == CYCLE_COMPLETE);
    CHECK(cycle_next_action(3, 1, 3) == CYCLE_COMPLETE);
    CHECK(cycle_next_action(3, 0, 3) == CYCLE_FAILED);

    /* single-sample configuration */
    CHECK(cycle_next_action(1, 1, 1) == CYCLE_COMPLETE);
    CHECK(cycle_next_action(1, 0, 1) == CYCLE_FAILED);

    /* defensive: more attempts than configured never asks for another sample */
    CHECK(cycle_next_action(4, 0, 3) == CYCLE_FAILED);
}

/* recovery_action(): the ladder must fire at 5, 10, 15, 20 ... with the
 * default thresholds (5 soft reset, 10 bus recovery) and nowhere else. */
static void test_recovery_ladder_defaults(void)
{
    CHECK(recovery_action(0, 5, 10)  == RECOVERY_NONE);
    CHECK(recovery_action(1, 5, 10)  == RECOVERY_NONE);
    CHECK(recovery_action(4, 5, 10)  == RECOVERY_NONE);
    CHECK(recovery_action(5, 5, 10)  == RECOVERY_SOFT_RESET);
    CHECK(recovery_action(6, 5, 10)  == RECOVERY_NONE);
    CHECK(recovery_action(9, 5, 10)  == RECOVERY_NONE);
    CHECK(recovery_action(10, 5, 10) == RECOVERY_BUS_AND_SOFT_RESET);
    CHECK(recovery_action(11, 5, 10) == RECOVERY_NONE);
    CHECK(recovery_action(15, 5, 10) == RECOVERY_SOFT_RESET);
    CHECK(recovery_action(20, 5, 10) == RECOVERY_BUS_AND_SOFT_RESET);
    CHECK(recovery_action(255, 5, 10) == RECOVERY_SOFT_RESET);   /* saturated counter */

    /* degenerate thresholds never trigger / never bus-recover */
    CHECK(recovery_action(10, 0, 10) == RECOVERY_NONE);
    CHECK(recovery_action(10, 5, 0)  == RECOVERY_SOFT_RESET);
}

/* Simulate temp_timer_cb + handle_sample_done over a dead sensor: every cycle
 * fails, the recovery cycle itself is counted as a failure (as thermometer.c
 * does), so the ladder must be: soft reset at cycle 5, bus+soft at 10, soft
 * at 15, bus+soft at 20, ... exactly as README "Edge-case behavior" states. */
static void test_recovery_ladder_sequence(void)
{
    uint8_t fails = 0;
    int soft_resets = 0, bus_recoveries = 0;
    int cycles_with_soft[8], cycles_with_bus[8];
    int ns = 0, nb = 0;

    for (int cycle = 1; cycle <= 40; cycle++)
    {
        recovery_action_t r = recovery_action(fails, 5, 10);
        if (r != RECOVERY_NONE)
        {
            if (r == RECOVERY_BUS_AND_SOFT_RESET)
            {
                bus_recoveries++;
                if (nb < 8) cycles_with_bus[nb++] = cycle;
            }
            soft_resets++;
            if (ns < 8) cycles_with_soft[ns++] = cycle;
            if (fails < UINT8_MAX) fails++;      /* the skipped cycle counts too */
            continue;
        }
        /* a measured cycle with zero valid samples */
        if (cycle_next_action(3, 0, 3) == CYCLE_FAILED && fails < UINT8_MAX)
        {
            fails++;
        }
    }

    /* The 5th failure is seen at the START of cycle 6 (first recovery); the
     * recovery cycle counts as a failure too, so the ladder then repeats
     * every 5 cycles: soft resets at 6, 11, 16, 21, 26, 31, 36 and, every
     * second rung (counter 10, 20, 30), a bus recovery first: 11, 21, 31. */
    CHECK(soft_resets == 7);
    CHECK(bus_recoveries == 3);
    CHECK(cycles_with_soft[0] == 6 && cycles_with_soft[1] == 11 && cycles_with_soft[2] == 16);
    CHECK(cycles_with_bus[0] == 11 && cycles_with_bus[1] == 21 && cycles_with_bus[2] == 31);
    /* every bus recovery is also a soft reset */
    CHECK(bus_recoveries < soft_resets);
}

/* A recovered sensor resets the ladder: one good cycle clears the counter */
static void test_recovery_clears_on_success(void)
{
    uint8_t fails = 7;
    if (cycle_next_action(3, 2, 3) == CYCLE_COMPLETE)
    {
        fails = 0;
    }
    CHECK(fails == 0);
    CHECK(recovery_action(fails, 5, 10) == RECOVERY_NONE);
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
    test_cycle_next_action();
    test_recovery_ladder_defaults();
    test_recovery_ladder_sequence();
    test_recovery_clears_on_success();

    if (g_failures)
    {
        printf("%d test check(s) FAILED\n", g_failures);
        return 1;
    }
    printf("All codec tests passed.\n");
    return 0;
}
