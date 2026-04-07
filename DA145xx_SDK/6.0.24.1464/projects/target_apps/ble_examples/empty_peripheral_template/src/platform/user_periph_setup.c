/**
 ****************************************************************************************
 *
 * @file user_periph_setup.c
 *
 * @brief Peripherals setup and initialization.
 *
 * Copyright (C) 2015-2025 Renesas Electronics Corporation and/or its affiliates.
 * All rights reserved. Confidential Information.
 *
 * This software ("Software") is supplied by Renesas Electronics Corporation and/or its
 * affiliates ("Renesas"). Renesas grants you a personal, non-exclusive, non-transferable,
 * revocable, non-sub-licensable right and license to use the Software, solely if used in
 * or together with Renesas products. You may make copies of this Software, provided this
 * copyright notice and disclaimer ("Notice") is included in all such copies. Renesas
 * reserves the right to change or discontinue the Software at any time without notice.
 *
 * THE SOFTWARE IS PROVIDED "AS IS". RENESAS DISCLAIMS ALL WARRANTIES OF ANY KIND,
 * WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. TO THE
 * MAXIMUM EXTENT PERMITTED UNDER LAW, IN NO EVENT SHALL RENESAS BE LIABLE FOR ANY DIRECT,
 * INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE, EVEN IF RENESAS HAS BEEN ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGES. USE OF THIS SOFTWARE MAY BE SUBJECT TO TERMS AND CONDITIONS CONTAINED IN
 * AN ADDITIONAL AGREEMENT BETWEEN YOU AND RENESAS. IN CASE OF CONFLICT BETWEEN THE TERMS
 * OF THIS NOTICE AND ANY SUCH ADDITIONAL LICENSE AGREEMENT, THE TERMS OF THE AGREEMENT
 * SHALL TAKE PRECEDENCE. BY CONTINUING TO USE THIS SOFTWARE, YOU AGREE TO THE TERMS OF
 * THIS NOTICE.IF YOU DO NOT AGREE TO THESE TERMS, YOU ARE NOT PERMITTED TO USE THIS
 * SOFTWARE.
 *
 ****************************************************************************************
 */

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */

#include "user_periph_setup.h"  // Нашите GPIO дефиниции (BUTTON1_PORT, OUT1_PIN и т.н.)
#include "datasheet.h"          // Регистри на чипа DA14535
#include "system_library.h"     // Системни функции на SDK
#include "rwip_config.h"        // Конфигурация на BLE стека
#include "gpio.h"               // GPIO функции (ConfigurePin, SetActive, и т.н.)
#include "uart.h"               // UART функции (за сериен порт)
#include "syscntl.h"            // Системен контрол (DCDC конвертор)
#include "fpga_helper.h"        // Помощник за FPGA (SWD дебъгер конфигурация)
#include "arch_console.h"       // UART printf функции (arch_printf, arch_printf_flush)
#include "i2c.h"                // I2C драйвер (i2c_init, i2c_master_transmit/receive_buffer_sync)

/*
 * ЗАБЕЛЕЖКА ЗА UM-B-182 / DA14535 USB Dev Kit:
 * ──────────────────────────────────────────────
 * UART маршрутизирането зависи от DIP ключетата на платката:
 * - 2-wire UART: P0_0 (TX), P0_1 (RX)
 * - 4-wire UART: P0_0 (TX), P0_1 (RX), P0_3 (CTS), P0_4 (RTS)
 * - 1-wire UART: P0_5 (TX/RX на един пин)
 *
 * Ако не виждаш UART изход → провери DIP ключетата И boot режима.
 */

/*
 * РЕЗЕРВИРАНЕ НА GPIO ПИНОВЕ (само в debug режим)
 * ════════════════════════════════════════════════════════════
 * Тази функция казва на SDK:
 *   "Тези пинове са ЗАЕТИ — не ги ползвай за друго!"
 *
 * RESERVE_GPIO(ИМЕ, ПОРТ, ПИН, ФУНКЦИЯ)
 *   ИМЕ     = описателно име (за debug съобщения)
 *   ПОРТ    = GPIO_PORT_0, GPIO_PORT_1, ...
 *   ПИН     = GPIO_PIN_0 ... GPIO_PIN_11
 *   ФУНКЦИЯ = PID_GPIO (обикновен I/O), PID_UART2_TX (UART), PID_SPI_EN (SPI), ...
 *
 * ВАЖНО: Тази функция съществува САМО когато DEVELOPMENT_DEBUG е включен!
 *        В release build — не се компилира.
 ****************************************************************************************
 */

#if DEVELOPMENT_DEBUG

void GPIO_reservations(void)
{
/*
    Пример: резервиране на P0_1 като обикновен GPIO:
    RESERVE_GPIO(DESCRIPTIVE_NAME, GPIO_PORT_0, GPIO_PIN_1, PID_GPIO);
*/

    // Резервираме пин за UART2 TX (за да може да печатаме debug съобщения)
#if defined (CFG_PRINTF_UART2)
    RESERVE_GPIO(UART2_TX, UART2_TX_PORT, UART2_TX_PIN, PID_UART2_TX);
#endif

    // Ако имаме LED на платката — резервираме и него
#if defined(GPIO_LED_PORT) && defined(GPIO_LED_PIN)
    RESERVE_GPIO(LED, GPIO_LED_PORT, GPIO_LED_PIN, PID_GPIO);
#endif

    // SPI chip-select пин (не за DA14586 — той има вграден SPI flash)
#if !defined (__DA14586__)
    RESERVE_GPIO(SPI_EN, SPI_EN_PORT, SPI_EN_PIN, PID_SPI_EN);
#endif

    // ═══ НАШИТЕ ПИНОВЕ ═══
    RESERVE_GPIO(BUTTON1, BUTTON1_PORT, BUTTON1_PIN, PID_GPIO);      // P0_7 — бутон 1
    RESERVE_GPIO(BUTTON2, BUTTON2_PORT, BUTTON2_PIN, PID_GPIO);      // P0_6 — бутон 2
    RESERVE_GPIO(OUT1, OUT1_PORT, OUT1_PIN, PID_GPIO);                // P0_9 — изход 1
    RESERVE_GPIO(OUT2, OUT2_PORT, OUT2_PIN, PID_GPIO);                // P0_11 — изход 2
    RESERVE_GPIO(I2C_SCL, I2C_SCL_PORT, I2C_SCL_PIN, PID_I2C_SCL);  // P0_8 — I2C clock
    RESERVE_GPIO(I2C_SDA, I2C_SDA_PORT, I2C_SDA_PIN, PID_I2C_SDA);  // P0_5 — I2C data
}

#endif  // DEVELOPMENT_DEBUG

/*
 * НАСТРОЙКА НА GPIO ПИНОВЕ (pad functions)
 * ════════════════════════════════════════════════════════════
 * Тази функция казва на всеки пин КАК да работи:
 *   - INPUT_PULLUP = вход с вътрешен pull-up (за бутони)
 *   - OUTPUT = изход (за LED/релета/и т.н.)
 *   - OUTPUT с PID_UART2_TX = изход за UART данни
 *
 * GPIO_ConfigurePin(ПОРТ, ПИН, РЕЖИМ, ФУНКЦИЯ, НАЧАЛНА_СТОЙНОСТ)
 *   НАЧАЛНА_СТОЙНОСТ: false = LOW (0V), true = HIGH (3.3V)
 *
 * ИЗВИКВА СЕ от periph_init() при всяко събуждане на чипа.
 */
void set_pad_functions(void)
{
    // Ако НЕ ползваме UART2 → конфигурираме SPI chip-select вместо него
#if !defined (CFG_PRINTF_UART2)
#if defined (__DA14586__)
    GPIO_ConfigurePin(GPIO_PORT_2, GPIO_PIN_3, OUTPUT, PID_GPIO, true);  // DA14586: вграден flash CS
#else
    GPIO_ConfigurePin(SPI_EN_PORT, SPI_EN_PIN, OUTPUT, PID_SPI_EN, true); // SPI flash CS = HIGH (неактивен)
#endif
#endif // !CFG_PRINTF_UART2

    // Ако ПОЛЗВАМЕ UART2 → конфигурираме TX и RX пиновете
#if defined (CFG_PRINTF_UART2)
    GPIO_ConfigurePin(UART2_TX_PORT, UART2_TX_PIN, OUTPUT, PID_UART2_TX, false); // TX = изход
    GPIO_ConfigurePin(UART2_RX_PORT, UART2_RX_PIN, INPUT,  PID_UART2_RX, false); // RX = вход
#endif

    // ═══ БУТОНИ ═══
    // INPUT_PULLUP = вход с вътрешен pull-up резистор
    // Когато бутонът е натиснат → пинът отива на GND (0) → active-low
    // Когато бутонът НЕ е натиснат → pull-up го държи на HIGH (1)
    GPIO_ConfigurePin(BUTTON1_PORT, BUTTON1_PIN, INPUT_PULLUP, PID_GPIO, false); // P0_7
    GPIO_ConfigurePin(BUTTON2_PORT, BUTTON2_PIN, INPUT_PULLUP, PID_GPIO, false); // P0_6

    // ═══ ИЗХОДИ ═══
    // OUTPUT = изход, false = започва от LOW (изключен)
    GPIO_ConfigurePin(OUT1_PORT, OUT1_PIN, OUTPUT, PID_GPIO, false);  // P0_3  = LOW
    GPIO_ConfigurePin(OUT2_PORT, OUT2_PIN, OUTPUT, PID_GPIO, false);  // P0_11 = LOW

    // ═══ I2C ПИНОВЕ ЗА AHT20 СЕНЗОР ═══
    // INPUT_PULLUP + true — както в accel-Sensor SDK примера.
    // Вътрешният pull-up помага на I2C линиите заедно с външните резистори.
    GPIO_ConfigurePin(I2C_SCL_PORT, I2C_SCL_PIN, INPUT_PULLUP, PID_I2C_SCL, true);  // P0_8 = SCL
    GPIO_ConfigurePin(I2C_SDA_PORT, I2C_SDA_PIN, INPUT_PULLUP, PID_I2C_SDA, true);  // P0_5  = SDA
}

/*
 * КОНФИГУРАЦИЯ НА UART2 (сериен порт за debug печат)
 * ════════════════════════════════════════════════════
 * Тази структура описва настройките на серийния порт:
 *   115200 baud, 8 data bits, no parity, 1 stop bit
 *
 * Използва се от uart_initialize() в periph_init().
 */
#if defined (CFG_PRINTF_UART2)
static const uart_cfg_t uart_cfg = {
    .baud_rate = UART2_BAUDRATE,       // 115200 бод (бита в секунда)
    .data_bits = UART2_DATABITS,       // 8 бита данни
    .parity = UART2_PARITY,            // Без паритет (no parity)
    .stop_bits = UART2_STOPBITS,       // 1 стоп бит
    .auto_flow_control = UART2_AFCE,   // Без хардуерен контрол на потока
    .use_fifo = UART2_FIFO,            // FIFO буфер = включен
    .tx_fifo_tr_lvl = UART2_TX_FIFO_LEVEL,  // Ниво на TX FIFO
    .rx_fifo_tr_lvl = UART2_RX_FIFO_LEVEL,  // Ниво на RX FIFO
    .intr_priority = 2,                // Приоритет на прекъсването (0=най-висок)
};
#endif

/*
 * ИНИЦИАЛИЗАЦИЯ НА ПЕРИФЕРИЯТА (извиква се при ВСЯКО събуждане)
 * ════════════════════════════════════════════════════════════════
 * Тази функция се изпълнява ВСЕКИ ПЪТ когато чипът се събуди от sleep.
 * DA14535 влиза в sleep за пестене на батерия → при събуждане GPIO
 * настройките се губят → трябва да ги настроим отново.
 *
 * Ред на изпълнение:
 *   1. Захранване на периферията (DCDC или power domain)
 *   2. ROM patch (поправки на фабричния код)
 *   3. Настройка на пиновете (set_pad_functions)
 *   4. Инициализация на UART2 (ако е включен)
 *   5. Отключване на пиновете (pad latch enable)
 *   6. Debug: мигане на OUT1 (за логически анализатор)
 *   7. Печат на boot банер по UART
 */
void periph_init(void)
{
    // ═══ СТЪПКА 1: Захранване ═══
#if defined (__DA14531__)
    // DA14531/535: Настройка на SWD дебъгер пинове
    FPGA_HELPER(FPGA_GPIO_MAP_1, SWD_DATA_AT_P0_5);

    // Включваме DCDC конвертора в Boost режим (3.0V за GPIO)
    // Без това GPIO пиновете НЯМА да работят!
    syscntl_dcdc_turn_on_in_boost(SYSCNTL_DCDC_LEVEL_3V0);
#else
    // По-стари чипове (DA14585/586): събуждаме периферийния домейн
    SetBits16(PMU_CTRL_REG, PERIPH_SLEEP, 0);       // Казваме: "Не спи!"
    while (!(GetWord16(SYS_STAT_REG) & PER_IS_UP));  // Чакаме да се събуди
    SetBits16(CLK_16M_REG, XTAL16_BIAS_SH_ENABLE, 1); // Включваме 16MHz кристала
#endif

    // ═══ СТЪПКА 2: ROM patch ═══
    // Поправки на вградения ROM код (от Renesas)
    patch_func();

    // ═══ СТЪПКА 3: Настройка на пиновете ═══
    // Казваме на всеки пин: "Ти си вход", "Ти си изход", "Ти си UART", ...
    set_pad_functions();

    // ═══ СТЪПКА 3.5: Забраняваме HW Reset на P0_0 ═══
    // КРИТИЧНО: P0_0 по подразбиране е RST (Hardware Reset) пин!
    // След boot-а, RST функцията се ВЪЗСТАНОВЯВА автоматично.
    // Без тази забрана P0_0 остава в RST режим и UART TX не работи!
    // Виж: AN-B-072, секция 3 "Reset Functionality in DA1453x":
    //   "After the booting, the reset functionality on the P0_0 is restored."
    // GPIO_Disable_HW_Reset() записва 1 в HWR_CTRL_REG → забранява RST на P0_0.
#if defined(__DA14531__) && defined(CFG_PRINTF_UART2)
    GPIO_Disable_HW_Reset();
#endif

    // ═══ СТЪПКА 4: UART2 инициализация ═══
#if defined (CFG_PRINTF_UART2)
    // ВАЖНО: Първо настройваме пиновете (стъпка 3), ПОСЛЕ инициализираме UART!
    // Ако обърнем реда → UART ще пише в ненастроен пин → няма изход.
    uart_initialize(UART2, &uart_cfg);
#endif

    // ═══ СТЪПКА 4.5: Отключване на пиновете ═══
    // ПРЕМЕСТЕНО преди I2C за да може Bus Recovery да работи с GPIO.
    // "Pad latch" = заключалка. Докато е заключена, GPIO промените
    // НЕ достигат до физическите пинове.
    GPIO_set_pad_latch_en(true);

    // ═══ СТЪПКА 4.6: I2C инициализация за AHT20 сензор ═══
    // ЗАБЕЛЕЖКА: Bus Recovery е ПРЕМАХНАТ — причиняваше ARB_LOST при wake-up!
    // periph_init() се извиква при ВСЯКО wake-up от sleep.
    // 9 SCL клока при wake-up объркваха AHT20 (интерпретира ги като данни).
    {
        static const i2c_cfg_t i2c_cfg = {
            .clock_cfg.ss_hcnt = I2C_SS_SCL_HCNT_REG_RESET,
            .clock_cfg.ss_lcnt = I2C_SS_SCL_LCNT_REG_RESET,
            .clock_cfg.fs_hcnt = I2C_FS_SCL_HCNT_REG_RESET,
            .clock_cfg.fs_lcnt = I2C_FS_SCL_LCNT_REG_RESET,
            .restart_en = I2C_RESTART_ENABLE,
            .speed      = I2C_SPEED_STANDARD,
            .mode       = I2C_MODE_MASTER,
            .addr_mode  = I2C_ADDRESSING_7B,
            .address    = AHT20_I2C_ADDRESS,
            .tx_fifo_level = 1,
            .rx_fifo_level = 1,
        };
        i2c_init(&i2c_cfg);
    }

    // ═══ СТЪПКА 6: ДИРЕКТЕН ХАРДУЕРЕН ТЕСТ НА UART2 ═══
#if defined (CFG_PRINTF_UART2)
    // uart_write_buffer() е BLOCKING функция — пише директно в TX FIFO.
    // НЕ използва ke_malloc(), НЕ използва interrupts → безопасна е тук.
    // ВАЖНО: Трябва да е СЛЕД GPIO_set_pad_latch_en(true)!
    // Без pad latch → данните отиват в FIFO, но пинът е заключен → нищо не излиза.
    {
        const uint8_t hw_test[] = "HW_OK\r\n";
        uart_write_buffer(UART2, hw_test, sizeof(hw_test) - 1);
        uart_wait_tx_finish(UART2);
    }
#endif

    // ═══ СТЪПКА 7: Debug мигане на OUT1 ═══
#if DEVELOPMENT_DEBUG
    // ═══ Debug мигане на OUT1 (само в debug build) ═══
    // Мигаме OUT1 (P0_9) два пъти при boot-а.
    // Ако видиш мигане на логически анализатор → кодът стига до тук!
    GPIO_SetActive(OUT1_PORT, OUT1_PIN);               // OUT1 = HIGH (3.3V)
    for (volatile int i = 0; i < 50000; i++);          // Кратко забавяне
    GPIO_SetInactive(OUT1_PORT, OUT1_PIN);             // OUT1 = LOW  (0V)
    for (volatile int i = 0; i < 50000; i++);          // Кратко забавяне
    GPIO_SetActive(OUT1_PORT, OUT1_PIN);               // OUT1 = HIGH (второ мигане)
    for (volatile int i = 0; i < 50000; i++);
    GPIO_SetInactive(OUT1_PORT, OUT1_PIN);             // OUT1 = LOW  (край)
#endif

    // ═══ СТЪПКА 8: Boot банер ═══
    // ЗАБЕЛЕЖКА: arch_printf() използва ke_malloc() от BLE kernel heap.
    // В periph_init() heap-ът НЕ е готов → arch_printf() тук ще предизвика
    // platform_reset() → ASSERT → BKPT. Затова банерът е преместен
    // в user_app_init() (user_peripheral.c), където heap-ът вече е инициализиран.
}
