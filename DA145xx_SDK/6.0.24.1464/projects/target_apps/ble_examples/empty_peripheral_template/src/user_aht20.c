/**
 ****************************************************************************************
 *
 * @file user_aht20.c
 *
 * @brief AHT20 температурен и влажностен I2C сензор — драйвер (имплементация).
 *
 * Комуникация по I2C с AHT20:
 *   1. Инициализация: проверка на калибровъчен бит + команда 0xBE
 *   2. Стартиране на измерване: команда 0xAC 0x33 0x00
 *   3. Четене: 6 байта → 2 × 20-bit → температура и влажност
 *
 * Формули (от datasheet-а):
 *   Влажност: RH% = (raw_humidity / 2^20) × 100
 *   Температура: T°C = (raw_temperature / 2^20) × 200 − 50
 *
 * Ние ползваме целочислена аритметика (без float):
 *   hum_x10  = raw_humidity * 1000 / 1048576      (×10 за 1 знак след запетаята)
 *   temp_x10 = raw_temperature * 2000 / 1048576 - 500   (×10, със знак)
 *
 ****************************************************************************************
 */

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ
 ****************************************************************************************
 */
#include "user_aht20.h"
#include "i2c.h"                // i2c_master_transmit/receive_buffer_sync()
#include "user_periph_setup.h"  // AHT20_I2C_ADDRESS
#include "arch_console.h"       // arch_printf (за диагностика)

/*
 * ЛОКАЛНИ ФУНКЦИИ
 ****************************************************************************************
 */

/**
 ****************************************************************************************
 * @brief Изпраща масив от байтове по I2C към AHT20.
 *
 * @param[in] data  указател към байтовете за изпращане
 * @param[in] len   брой байтове
 *
 * @return true  — изпратено успешно (без abort)
 * @return false — I2C abort (няма ACK от сензора или друга грешка)
 ****************************************************************************************
 */
static i2c_abort_t s_last_abort = I2C_ABORT_NONE;  // Последният I2C abort код (за диагностика)

static bool aht20_i2c_write(const uint8_t *data, uint16_t len)
{
    i2c_abort_t abrt_code = I2C_ABORT_NONE;

    // I2C_F_ADD_STOP | I2C_F_WAIT_FOR_STOP — както Arduino Wire.endTransmission().
    // AHT20 ИЗИСКВА STOP след всеки WRITE за да започне обработка на командата.
    // Без STOP → шината остава заета → сензорът не реагира → ARB_LOST!
    i2c_master_transmit_buffer_sync(data, len, &abrt_code,
                                    I2C_F_ADD_STOP | I2C_F_WAIT_FOR_STOP);

    s_last_abort = abrt_code;

    // ВАЖНО (SDK): При TX_ABORT TX FIFO остава flush-нат, докато не се
    // изчисти чрез i2c_reset_int_tx_abort(). Ако не го чистим, следващи
    // трансфери (вкл. I2C scan) дават фалшиви резултати.
    if (abrt_code != I2C_ABORT_NONE)
    {
        i2c_reset_int_tx_abort();
    }
    return (abrt_code == I2C_ABORT_NONE);
}

/**
 ****************************************************************************************
 * @brief Чете масив от байтове по I2C от AHT20.
 *
 * @param[out] data  буфер за приетите байтове
 * @param[in]  len   брой байтове за четене
 *
 * @return true  — прочетено успешно
 * @return false — I2C abort
 ****************************************************************************************
 */
static bool aht20_i2c_read(uint8_t *data, uint16_t len)
{
    i2c_abort_t abrt_code = I2C_ABORT_NONE;

    // I2C_F_ADD_STOP — SDK документация за receive_buffer_sync (DA14531/535)
    // позволява само I2C_F_NONE и I2C_F_ADD_STOP за READ операции.
    i2c_master_receive_buffer_sync(data, len, &abrt_code,
                                   I2C_F_ADD_STOP);

    s_last_abort = abrt_code;

    // READ също може да завърши с TX_ABORT (read команди минават през DATA_CMD/TX).
    if (abrt_code != I2C_ABORT_NONE)
    {
        i2c_reset_int_tx_abort();
    }
    return (abrt_code == I2C_ABORT_NONE);
}

/*
 * ПУБЛИЧНИ ФУНКЦИИ
 ****************************************************************************************
 */

bool aht20_init(void)
{
    // Стъпка 0: AHT20 datasheet изисква ≥40ms изчакване след подаване на VDD
    // преди първата I2C комуникация. Без това сензорът може да не отговори!
    for (volatile uint32_t i = 0; i < 320000; i++);  // ~40ms при 16MHz

    // Стъпка 1: Изпращаме команда за инициализация: 0xBE 0x08 0x00
    // Точно както Arduino: Wire.write(0xBE); Wire.write(0x08); Wire.write(0x00);
    // Wire.endTransmission() → STOP след write!
    // НЯМА standalone read — AHT20 не поддържа read без предходна write команда!
    uint8_t init_cmd[3] = { AHT20_CMD_INIT, 0x08, 0x00 };
    if (!aht20_i2c_write(init_cmd, 3))
    {
#if defined (CFG_PRINTF)
        arch_printf("[AHT20] INIT ABORT=%d\r\n", (int)s_last_abort);
        arch_printf_flush();
#endif
        return false;
    }

    // Стъпка 2: Изчакваме 100ms за калибровка (Arduino: delay(100))
    for (volatile uint32_t i = 0; i < 800000; i++);  // ~100ms при 16MHz

    return true;
}

void aht20_trigger_measurement(void)
{
    // Команда за стартиране на измерване: 0xAC, 0x33, 0x00
    // Arduino: Wire.write(0xAC); Wire.write(0x33); Wire.write(0x00);
    //          Wire.endTransmission(); → STOP!
    uint8_t cmd[3] = { AHT20_CMD_TRIGGER, 0x33, 0x00 };
    if (!aht20_i2c_write(cmd, 3))
    {
#if defined (CFG_PRINTF)
        arch_printf("[AHT20] TRIG ABORT=%d\r\n", (int)s_last_abort);
#endif
    }
}

bool aht20_is_busy(void)
{
    // Четем 1 байт директно от сензора (без команда)
    // Първият байт при четене е винаги статус байтът
    uint8_t status = 0xFF;  // По подразбиране = зает
    aht20_i2c_read(&status, 1);

    // Бит 7 = 1 означава "зает" (все още измерва)
    return (status & AHT20_STATUS_BUSY_BIT) != 0;
}

void i2c_scan_bus(void)
{
#if defined (CFG_PRINTF)
    arch_printf("[I2C] Scanning 0x08..0x77\r\n");
    arch_printf_flush();
#endif

    uint8_t found = 0;

    for (uint8_t addr = 0x08; addr < 0x78; addr++)
    {
        // 1. Disable контролера (задължително за смяна на адрес)
        i2c_set_controller_status(I2C_CONTROLLER_DISABLE);
        while (i2c_get_controller_status() != I2C_CONTROLLER_DISABLE);

        // 2. Задаваме нов target адрес
        i2c_set_target_address(addr);

        // 3. Enable контролера
        i2c_set_controller_status(I2C_CONTROLLER_ENABLE);
        while (i2c_get_controller_status() != I2C_CONTROLLER_ENABLE);

        // 4. Пробваме 1-байтов READ + STOP
        // READ е по-малко инвазивен от WRITE (не праща "случаен" байт към устройство).
        uint8_t dummy = 0x00;
        i2c_abort_t abrt = I2C_ABORT_NONE;
        i2c_master_receive_buffer_sync(&dummy, 1, &abrt,
                                       I2C_F_ADD_STOP | I2C_F_WAIT_FOR_STOP);

        // Изчистваме TX_ABORT, ако е възникнал, иначе следващите адреси може да са фалшиви.
        if (abrt != I2C_ABORT_NONE)
        {
            i2c_reset_int_tx_abort();
        }

        if (abrt == I2C_ABORT_NONE)
        {
#if defined (CFG_PRINTF)
            arch_printf("[I2C] Found: 0x%02X\r\n", addr);
#endif
            found++;
        }
    }

#if defined (CFG_PRINTF)
    arch_printf("[I2C] Done: %d device(s)\r\n", found);
    arch_printf_flush();
#endif

    // 5. Възстановяваме AHT20 адреса (0x38)
    i2c_set_controller_status(I2C_CONTROLLER_DISABLE);
    while (i2c_get_controller_status() != I2C_CONTROLLER_DISABLE);
    i2c_set_target_address(AHT20_I2C_ADDRESS);
    i2c_set_controller_status(I2C_CONTROLLER_ENABLE);
    while (i2c_get_controller_status() != I2C_CONTROLLER_ENABLE);

    // И след scan оставяме контролера в "чисто" състояние.
    i2c_reset_int_tx_abort();
}

bool aht20_read(int16_t *temp_x10, uint16_t *hum_x10)
{
    /*
     * AHT20 връща 6 байта при четене (без CRC):
     *
     *   Байт 0: Статус (бит 7 = busy, бит 3 = calibrated)
     *   Байт 1: Влажност [19:12]  — старшите 8 бита от 20-bit humidity
     *   Байт 2: Влажност [11:4]   — средните 8 бита
     *   Байт 3: Влажност [3:0] | Температура [19:16]  — споделен байт!
     *            Горните 4 бита = влажност [3:0]
     *            Долните 4 бита = температура [19:16]
     *   Байт 4: Температура [15:8] — средните 8 бита
     *   Байт 5: Температура [7:0]  — долните 8 бита
     *
     * Формули за преобразуване (от datasheet):
     *   RH%  = (raw_humidity    / 2^20) × 100
     *   T°C  = (raw_temperature / 2^20) × 200 − 50
     *
     * Целочислена аритметика (×10 за 1 знак):
     *   hum_x10  = raw_hum  × 1000 / 1048576
     *   temp_x10 = raw_temp × 2000 / 1048576 − 500
     */

    // Четем 6 байта от сензора
    uint8_t data[6] = {0};
    if (!aht20_i2c_read(data, 6))
    {
#if defined (CFG_PRINTF)
        arch_printf("[AHT20] READ6 ABORT=%d\r\n", (int)s_last_abort);
#endif
        return false;
    }

    // Проверяваме статус байта — ако е зает, данните не са валидни
    if (data[0] & AHT20_STATUS_BUSY_BIT)
    {
#if defined (CFG_PRINTF)
        arch_printf("[AHT20] BUSY st=0x%02X\r\n", data[0]);
#endif
        return false;
    }

    // ═══ Извличаме 20-bit сурова влажност ═══
    // Байт 1 = [19:12], Байт 2 = [11:4], Байт 3 горни 4 бита = [3:0]
    uint32_t raw_hum = ((uint32_t)data[1] << 12)
                     | ((uint32_t)data[2] << 4)
                     | ((uint32_t)data[3] >> 4);

    // ═══ Извличаме 20-bit сурова температура ═══
    // Байт 3 долни 4 бита = [19:16], Байт 4 = [15:8], Байт 5 = [7:0]
    uint32_t raw_temp = (((uint32_t)data[3] & 0x0F) << 16)
                      | ((uint32_t)data[4] << 8)
                      | ((uint32_t)data[5]);

    // ═══ Преобразуване в human-readable стойности (×10) ═══
    // hum_x10 = raw_hum × 1000 / 1048576
    //   Пример: raw_hum = 524288 → 524288*1000/1048576 = 500 → 50.0%
    *hum_x10 = (uint16_t)(raw_hum * 1000UL / 1048576UL);

    // temp_x10 = raw_temp × 2000 / 1048576 − 500
    //   Пример: raw_temp = 393216 → 393216*2000/1048576 = 750 → 750-500 = 250 → 25.0°C
    int32_t t = (int32_t)(raw_temp * 2000UL / 1048576UL) - 500;
     t =  t + 2;
    *temp_x10 = (int16_t)t;

    return true;
}

