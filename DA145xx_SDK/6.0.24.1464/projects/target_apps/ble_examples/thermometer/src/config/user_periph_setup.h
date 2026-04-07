/**
 ****************************************************************************************
 *
 * @file user_periph_setup.h
 *
 * @brief Peripherals setup header file for the BLE Thermometer application.
 *
 * Hardware connections for DA14535-00FXDEVKT-U development kit:
 *
 *   AHT20 Temperature and Humidity Sensor:
 *     VDD  -> 3.3V on devkit J3 connector
 *     GND  -> GND
 *     SCL  -> P0_7 (J3 pin)  -- 4.7 kOhm pull-up to 3.3 V required
 *     SDA  -> P0_6 (J3 pin)  -- 4.7 kOhm pull-up to 3.3 V required
 *     (I2C address is fixed at 0x38, no address-select pin)
 *
 * NOTE: P0_1 and P0_2 are the SWD_DATA/SWD_CLK pins -- do NOT use them for I2C
 *       as it would disable the JTAG/SWD debug interface while the firmware runs.
 *       P0_6 and P0_7 are free on DA14535 (no DIP switch conflicts). Note that
 *       P0_6 is UART2_TX on DA14531 builds, so these pins are DA14535-only.
 *
 *   User LED  -> P0_9  (on-board LED, active high)
 *   User Button -> P0_11 (on-board button, active low with internal pull-up)
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 ****************************************************************************************
 */

#ifndef _USER_PERIPH_SETUP_H_
#define _USER_PERIPH_SETUP_H_

#include "gpio.h"
#include "uart.h"
#include "i2c.h"

/****************************************************************************************/
/* UART2 - debug console (optional, disable CFG_PRINTF_UART2 to remove)                */
/****************************************************************************************/
#if defined (__DA14531__)
    #define UART2_TX_PORT           GPIO_PORT_0
    #define UART2_TX_PIN            GPIO_PIN_6
#else
    #define UART2_TX_PORT           GPIO_PORT_0
    #define UART2_TX_PIN            GPIO_PIN_4
#endif

#define UART2_BAUDRATE              UART_BAUDRATE_115200
#define UART2_DATABITS              UART_DATABITS_8
#define UART2_PARITY                UART_PARITY_NONE
#define UART2_STOPBITS              UART_STOPBITS_1
#define UART2_AFCE                  UART_AFCE_DIS
#define UART2_FIFO                  UART_FIFO_EN
#define UART2_TX_FIFO_LEVEL         UART_TX_FIFO_LEVEL_0
#define UART2_RX_FIFO_LEVEL         UART_RX_FIFO_LEVEL_0

/****************************************************************************************/
/* I2C - connects to AHT20 temperature and humidity sensor                              */
/* Physical connections: SCL=P0_7, SDA=P0_6  (4.7 kOhm pull-ups to 3.3 V required)     */
/****************************************************************************************/
#define I2C_SCL_PORT                GPIO_PORT_0
#define I2C_SCL_PIN                 GPIO_PIN_7

#define I2C_SDA_PORT                GPIO_PORT_0
#define I2C_SDA_PIN                 GPIO_PIN_6

/// AHT20 I2C slave address (fixed, no address-select pin)
#define I2C_TEMP_SENSOR_ADDRESS     (0x38)

/// I2C bus speed: fast mode (400 kbps) - AHT20 supports up to 400 kHz
#define I2C_SPEED_MODE              I2C_SPEED_FAST
#define I2C_ADDRESS_MODE            I2C_ADDRESSING_7B

/****************************************************************************************/
/* Battery Service - alert LED (not used on this board, set to 0 to disable)           */
/****************************************************************************************/
#define USE_BAT_LEVEL_ALERT             0

#if defined (__DA14531__)
    #define GPIO_BAT_LED_PORT           GPIO_PORT_0
    #define GPIO_BAT_LED_PIN            GPIO_PIN_9
#else
    #define GPIO_BAT_LED_PORT           GPIO_PORT_1
    #define GPIO_BAT_LED_PIN            GPIO_PIN_0
#endif

/****************************************************************************************/
/* User LED - active high output                                                        */
/* DA14535-00FXDEVKT-U: P0_9 controls the on-board user LED                            */
/****************************************************************************************/
#if defined (__DA14531__)
    #define GPIO_LED_PORT           GPIO_PORT_0
    #define GPIO_LED_PIN            GPIO_PIN_9
#else
    #define GPIO_LED_PORT           GPIO_PORT_1
    #define GPIO_LED_PIN            GPIO_PIN_0
#endif

/****************************************************************************************/
/* User Button - active low, with internal pull-up                                      */
/* DA14535-00FXDEVKT-U: P0_11 is the user push button                                  */
/****************************************************************************************/
#if defined (__DA14531__)
    #define GPIO_BUTTON_PORT        GPIO_PORT_0
    #define GPIO_BUTTON_PIN         GPIO_PIN_11
#else
    #define GPIO_BUTTON_PORT        GPIO_PORT_1
    #define GPIO_BUTTON_PIN         GPIO_PIN_1
#endif

/****************************************************************************************/
/* Hibernation wake-up (DA14531/DA14535 only)                                           */
/****************************************************************************************/
#if defined (__DA14531__)
    #define HIB_WAKE_UP_PORT        GPIO_PORT_0
    #define HIB_WAKE_UP_PIN         GPIO_PIN_3
    #define HIB_WAKE_UP_PIN_MASK    (1 << HIB_WAKE_UP_PIN)
#endif

void periph_init(void);
void GPIO_reservations(void);
void set_pad_functions(void);

#endif // _USER_PERIPH_SETUP_H_
