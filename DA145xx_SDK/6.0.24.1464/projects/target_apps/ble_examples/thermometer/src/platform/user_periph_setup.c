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

    /* I2C for AHT20 -- configured as open-drain with pull-ups on the PCB */
    GPIO_ConfigurePin(I2C_SCL_PORT, I2C_SCL_PIN, INPUT, PID_I2C_SCL, false);
    GPIO_ConfigurePin(I2C_SDA_PORT, I2C_SDA_PIN, INPUT, PID_I2C_SDA, false);
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

    GPIO_set_pad_latch_en(true);
}
