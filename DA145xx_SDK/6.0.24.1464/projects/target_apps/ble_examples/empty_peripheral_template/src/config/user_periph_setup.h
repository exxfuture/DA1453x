/**
 ****************************************************************************************
 *
 * @file user_periph_setup.h
 *
 * @brief Peripherals setup header file.
 *
 * Тук описваме кои GPIO пинове ползваме за:
 *  - 2 бутона (входове)
 *  - 2 изхода (LED/Buzzer/друго)
 *  - I2C шина за AHT20 сензор (температура/влажност)
 *
 ****************************************************************************************
 */

#ifndef _USER_PERIPH_SETUP_H_
#define _USER_PERIPH_SETUP_H_

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */
#include "arch.h"           // Архитектурни дефиниции на DA14535
#include "gpio.h"           // GPIO_PORT_0, GPIO_PIN_x и т.н.
#include "uart.h"           // UART_BAUDRATE_115200, UART_DATABITS_8 и т.н.

/*
 * DEFINES
 ****************************************************************************************
 *
 * Важно за начинаещи:
 * - PORT е групата (GPIO_PORT_0, GPIO_PORT_1, ...)
 * - PIN е номерът в тази група (GPIO_PIN_0 ... GPIO_PIN_11)
 *
 * Препоръка за свързване на бутон:
 * - бутонът свързва пина към GND (active-low)
 * - в софтуера включваме pull-up (в set_pad_functions/periph_init)
 */

// =====================
// 2 входа: бутони
// =====================

// Button 1: пример P0_7
#define BUTTON1_PORT        GPIO_PORT_0
#define BUTTON1_PIN         GPIO_PIN_7

// Button 2: P0_6
#define BUTTON2_PORT        GPIO_PORT_0
#define BUTTON2_PIN         GPIO_PIN_6

// =====================
// 2 изхода: OUT1/OUT2
// =====================

// OUT1: пример P0_9
#define OUT1_PORT           GPIO_PORT_0
#define OUT1_PIN            GPIO_PIN_3

// OUT2: пример P0_11
#define OUT2_PORT           GPIO_PORT_0
#define OUT2_PIN            GPIO_PIN_11

// =====================
// I2C шина за AHT20 сензор (температура + влажност)
// =====================
// AHT20 е I2C сензор с адрес 0x38.
// Ползваме: P0_8 (SCL) и P0_5 (SDA).
// ВАЖНО: P0_2 (SWCLK) и P0_10 (SWDIO) са за debug — НЕ ги ползвай!

// I2C SCL (clock): P0_8
#define I2C_SCL_PORT        GPIO_PORT_0
#define I2C_SCL_PIN         GPIO_PIN_8

// I2C SDA (data): P0_5
#define I2C_SDA_PORT        GPIO_PORT_0
#define I2C_SDA_PIN         GPIO_PIN_5

// AHT20 I2C адрес (7-bit): 0x38
#define AHT20_I2C_ADDRESS   0x38


/****************************************************************************************/
/* UART2 configuration to use with arch_console print messages                          */
/****************************************************************************************/
/*
 * UM-B-182 (DA14535 USB Dev Kit):
 *   DIP switch S1 рутира UART сигналите:
 *     DIP 9 = P0_0 → T_TX (UART TX)
 *     DIP 8 = P0_1 → T_RX (UART RX)
 *     DIP 6 = P0_3 → T_CTS
 *     DIP 7 = P0_4 → T_RTS
 *   Виж: UM-B-182 Figure 8, Table 3
 *   ВАЖНО: DIP 9 и DIP 8 трябва да са в позиция ON!
 *
 * DEVKT-P (Pro Development Kit):
 *   UART TX = P0_6 (J1.17 → J2.27)
 *   Виж: DA14535 Getting Started, Table 6
 *
 * Настройка на терминала: 115200, 8N1
 */
#if defined(__DA14535__)
    // UM-B-182: UART2 TX = P0_0, RX = P0_1 (през DIP switch S1)
    #define UART2_TX_PORT GPIO_PORT_0
    #define UART2_TX_PIN  GPIO_PIN_0
    #define UART2_RX_PORT GPIO_PORT_0
    #define UART2_RX_PIN  GPIO_PIN_1
#elif defined(__DA14531__)
    // DA14531 DEVKT-P: UART2 TX = P0_6, RX = P0_5
    #define UART2_TX_PORT GPIO_PORT_0
    #define UART2_TX_PIN  GPIO_PIN_6
    #define UART2_RX_PORT GPIO_PORT_0
    #define UART2_RX_PIN  GPIO_PIN_5
#else
    #error "Unknown DA14xxx device — добави UART2 пин дефиниция!"
#endif


// ═══ Настройки на UART2 (сериен порт за debug) ═══
// Тези стойности се ползват в uart_cfg структурата (user_periph_setup.c)
// и трябва да съвпадат с настройките на терминала на компютъра.
#define UART2_BAUDRATE              UART_BAUDRATE_115200    // Скорост: 115200 бита/сек
#define UART2_DATABITS              UART_DATABITS_8         // 8 бита данни
#define UART2_PARITY                UART_PARITY_NONE        // Без паритет
#define UART2_STOPBITS              UART_STOPBITS_1         // 1 стоп бит
#define UART2_AFCE                  UART_AFCE_DIS           // Без хардуерен flow control (CTS/RTS)
#define UART2_FIFO                  UART_FIFO_EN            // FIFO буфер = включен
#define UART2_TX_FIFO_LEVEL         UART_TX_FIFO_LEVEL_0   // TX FIFO ниво (0 = празно → прекъсване)
#define UART2_RX_FIFO_LEVEL         UART_RX_FIFO_LEVEL_0   // RX FIFO ниво (0 = 1 байт → прекъсване)

/*
 * SPI КОНФИГУРАЦИЯ (за външна flash памет)
 ****************************************************************************************
 * НЕ ползваме SPI в нашия проект, но SDK-то иска тези дефиниции.
 * SPI_EN = Chip Select (CS) — избира SPI flash чипа
 * SPI_CLK = Clock — тактов сигнал
 * SPI_DO = Data Out (MOSI) — данни от чипа КЪМ flash
 * SPI_DI = Data In (MISO) — данни ОТ flash КЪМ чипа
 */
#if defined (__DA14531__)
    #define SPI_EN_PORT             GPIO_PORT_0
    #define SPI_EN_PIN              GPIO_PIN_1

    #define SPI_CLK_PORT            GPIO_PORT_0
    #define SPI_CLK_PIN             GPIO_PIN_4

    #define SPI_DO_PORT             GPIO_PORT_0
    #define SPI_DO_PIN              GPIO_PIN_0

    #define SPI_DI_PORT             GPIO_PORT_0
    #define SPI_DI_PIN              GPIO_PIN_3

#elif !defined (__DA14586__)
    #define SPI_EN_PORT             GPIO_PORT_0
    #define SPI_EN_PIN              GPIO_PIN_3

    #define SPI_CLK_PORT            GPIO_PORT_0
    #define SPI_CLK_PIN             GPIO_PIN_0

    #define SPI_DO_PORT             GPIO_PORT_0
    #define SPI_DO_PIN              GPIO_PIN_6

    #define SPI_DI_PORT             GPIO_PORT_0
    #define SPI_DI_PIN              GPIO_PIN_5
#endif

/*
 * Продукционен debug изход (Production Debug)
 ****************************************************************************************
 * Когато устройството е в production mode, този пин може да се използва
 * за диагностика. НЕ се ползва в нашия проект (development mode).
 */
#if PRODUCTION_DEBUG_OUTPUT
#if defined (__DA14531__)
    #define PRODUCTION_DEBUG_PORT   GPIO_PORT_0
    #define PRODUCTION_DEBUG_PIN    GPIO_PIN_11
#else
    #define PRODUCTION_DEBUG_PORT   GPIO_PORT_2
    #define PRODUCTION_DEBUG_PIN    GPIO_PIN_5
#endif
#endif

/*
 * ДЕКЛАРАЦИИ НА ФУНКЦИИ
 ****************************************************************************************
 * Реализацията е в user_periph_setup.c
 */

#if DEVELOPMENT_DEBUG
/// Резервира GPIO пиновете (само в debug build — проверява за конфликти)
void GPIO_reservations(void);
#endif

/// Настройва всеки GPIO пин: вход/изход, функция, начална стойност
void set_pad_functions(void);

/// Инициализация на периферията — извиква се при ВСЯКО събуждане от sleep
void periph_init(void);

#endif // _USER_PERIPH_SETUP_H_
