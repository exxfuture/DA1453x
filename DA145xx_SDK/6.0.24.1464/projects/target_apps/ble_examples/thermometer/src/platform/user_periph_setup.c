/**
 ****************************************************************************************
 *
 * @file user_periph_setup.c
 *
 * @brief Peripherals setup and initialization for BLE Thermometer.
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#include "rwip_config.h"
#include "datasheet.h"
#include "user_periph_setup.h"
#include "system_library.h"
#include "gpio.h"
#include "uart.h"
#include "syscntl.h"
#include "thermometer.h"
#include "i2c_temp_sensor.h"
#include "arch.h"

#if defined (__DA14531__)
#include "rf_531.h"
#endif

#if BLE_BATT_SERVER
#include "app_bass.h"
#endif

#if DEVELOPMENT_DEBUG

void GPIO_reservations(void)
{
    RESERVE_GPIO(PUSH_BUTTON, GPIO_BUTTON_PORT, GPIO_BUTTON_PIN, PID_GPIO);

#if defined (__DA14531__) && (defined (CFG_APP_GOTO_HIBERNATION) || defined (CFG_APP_GOTO_STATEFUL_HIBERNATION))
    RESERVE_GPIO(HIB_WAKE_UP, HIB_WAKE_UP_PORT, HIB_WAKE_UP_PIN, PID_GPIO);
#endif

    /* User LED */
    RESERVE_GPIO(USER_LED, GPIO_LED_PORT, GPIO_LED_PIN, PID_GPIO);

#if (BLE_BATT_SERVER && USE_BAT_LEVEL_ALERT)
    RESERVE_GPIO(RED_LED, GPIO_BAT_LED_PORT, GPIO_BAT_LED_PIN, PID_GPIO);
#endif

#if defined (CFG_PRINTF_UART2)
    RESERVE_GPIO(UART2_TX, UART2_TX_PORT, UART2_TX_PIN, PID_UART2_TX);
#endif

    /* I2C for AHT20 */
    RESERVE_GPIO(I2C_SCL, I2C_SCL_PORT, I2C_SCL_PIN, PID_I2C_SCL);
    RESERVE_GPIO(I2C_SDA, I2C_SDA_PORT, I2C_SDA_PIN, PID_I2C_SDA);
}

#endif /* DEVELOPMENT_DEBUG */

void set_pad_functions(void)
{
#if defined (__DA14586__)
    GPIO_ConfigurePin(GPIO_PORT_2, GPIO_PIN_3, OUTPUT, PID_GPIO, true);
#endif

    GPIO_ConfigurePin(GPIO_BUTTON_PORT, GPIO_BUTTON_PIN, INPUT_PULLUP, PID_GPIO, false);

#if defined (__DA14531__) && (defined (CFG_APP_GOTO_HIBERNATION) || defined (CFG_APP_GOTO_STATEFUL_HIBERNATION))
    GPIO_ConfigurePin(HIB_WAKE_UP_PORT, HIB_WAKE_UP_PIN, INPUT_PULLUP, PID_GPIO, false);
#endif

    /* User LED - start off */
    GPIO_ConfigurePin(GPIO_LED_PORT, GPIO_LED_PIN, OUTPUT, PID_GPIO, false);

#if (BLE_BATT_SERVER && USE_BAT_LEVEL_ALERT)
    GPIO_ConfigurePin(GPIO_BAT_LED_PORT, GPIO_BAT_LED_PIN, OUTPUT, PID_GPIO, false);
#endif

#if defined (CFG_PRINTF_UART2)
    GPIO_ConfigurePin(UART2_TX_PORT, UART2_TX_PIN, OUTPUT, PID_UART2_TX, false);
#endif

    /* I2C for AHT20 -- configured as open-drain with pull-ups on the PCB.
     * periph_init() (and therefore this function) also runs from the button
     * WKUPCT ISR; while an AHT20 transfer is in flight the pads already
     * belong to the I2C block, and re-issuing GPIO_ConfigurePin() on them
     * mid-transaction can corrupt it or leave the bus undefined.  The pads
     * are only (re)assigned when the driver is idle. */
    if (!i2c_temp_sensor_busy())
    {
        GPIO_ConfigurePin(I2C_SCL_PORT, I2C_SCL_PIN, INPUT, PID_I2C_SCL, false);
        GPIO_ConfigurePin(I2C_SDA_PORT, I2C_SDA_PIN, INPUT, PID_I2C_SDA, false);
    }
}

#if defined (CFG_PRINTF_UART2)
static const uart_cfg_t uart_cfg = {
    .baud_rate        = UART2_BAUDRATE,
    .data_bits        = UART2_DATABITS,
    .parity           = UART2_PARITY,
    .stop_bits        = UART2_STOPBITS,
    .auto_flow_control = UART2_AFCE,
    .use_fifo         = UART2_FIFO,
    .tx_fifo_tr_lvl   = UART2_TX_FIFO_LEVEL,
    .rx_fifo_tr_lvl   = UART2_RX_FIFO_LEVEL,
    .intr_priority    = 2,
};
#endif

void periph_init(void)
{
#if defined (__DA14531__)
    /* Disable HW RST on P0_0 */
    GPIO_Disable_HW_Reset();

    /* In Boost mode enable the DCDC converter to supply VBAT_HIGH for the GPIOs */
    syscntl_dcdc_turn_on_in_boost(SYSCNTL_DCDC_LEVEL_3V0);
#else
    SetBits16(PMU_CTRL_REG, PERIPH_SLEEP, 0);
    while (!(GetWord16(SYS_STAT_REG) & PER_IS_UP));
    SetBits16(CLK_16M_REG, XTAL16_BIAS_SH_ENABLE, 1);
#endif

    patch_func();

#if defined (CFG_PRINTF_UART2)
    uart_initialize(UART2, &uart_cfg);
#endif

    set_pad_functions();

    app_button_enable();

#if BLE_BATT_SERVER
    app_batt_port_reinit();
#endif

#if defined (__DA14531__) && defined (CFG_TX_POWER_LEVEL)
    rf_pa_pwr_set(CFG_TX_POWER_LEVEL);
#endif

    GPIO_set_pad_latch_en(true);
}

void i2c_bus_recover(void)
{
    /* A slave stuck mid-transaction can hold SDA low forever, wedging the
     * bus.  Standard recovery: drive SCL manually for up to 9 clocks until
     * the slave releases SDA, then generate a STOP condition and hand the
     * pins back to the I2C peripheral. */

    GPIO_ConfigurePin(I2C_SCL_PORT, I2C_SCL_PIN, OUTPUT, PID_GPIO, true);
    GPIO_ConfigurePin(I2C_SDA_PORT, I2C_SDA_PIN, INPUT,  PID_GPIO, false);

    for (int i = 0; i < 9; i++)
    {
        if (GPIO_GetPinStatus(I2C_SDA_PORT, I2C_SDA_PIN))
        {
            break;  /* SDA released */
        }
        GPIO_SetInactive(I2C_SCL_PORT, I2C_SCL_PIN);
        arch_asm_delay_us(5);
        GPIO_SetActive(I2C_SCL_PORT, I2C_SCL_PIN);
        arch_asm_delay_us(5);
    }

    /* STOP condition: SDA low -> high while SCL is high */
    GPIO_ConfigurePin(I2C_SDA_PORT, I2C_SDA_PIN, OUTPUT, PID_GPIO, false);
    arch_asm_delay_us(5);
    GPIO_SetActive(I2C_SDA_PORT, I2C_SDA_PIN);
    arch_asm_delay_us(5);

    /* Restore the pads to the I2C peripheral */
    GPIO_ConfigurePin(I2C_SCL_PORT, I2C_SCL_PIN, INPUT, PID_I2C_SCL, false);
    GPIO_ConfigurePin(I2C_SDA_PORT, I2C_SDA_PIN, INPUT, PID_I2C_SDA, false);
}
