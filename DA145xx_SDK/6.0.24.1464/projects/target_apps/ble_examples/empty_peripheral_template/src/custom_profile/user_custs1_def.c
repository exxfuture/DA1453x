/**
 ****************************************************************************************
 *
 * @file user_custs1_def.c
 *
 * @brief Custom Server 1 (CUSTS1) profile database definitions.
 *
 * Опростена версия за упражнение:
 *  - SetTime  (WRITE)       : телефон -> устройство (UTF-8 "HH:MM:SS", max 8 chars)
 *  - Outputs  (WRITE)       : телефон -> устройство (1 byte mask: b0=OUT1, b1=OUT2)
 *  - Buttons  (NOTIFY)      : устройство -> телефон (1 byte mask: b0=B1,  b1=B2)
 *  - Time     (READ+NOTIFY) : устройство -> телефон (UTF-8 "HH:MM:SS", 8 chars)
 *
 ****************************************************************************************
 */

/**
 ****************************************************************************************
 * @defgroup USER_CONFIG
 * @ingroup USER
 * @brief Custom server 1 (CUSTS1) profile database definitions.
 * @{
 ****************************************************************************************
 */

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */
#include <stdint.h>            // uint8_t, uint16_t, uint32_t

#include "co_utils.h"          // ARRAY_LEN() — макрос за дължина на масив
#include "prf_types.h"         // Типове за BLE профили
#include "attm_db_128.h"       // GATT/ATT описания: PERM(), ATT_DECL_*, ATT_DESC_*
#include "user_custs1_def.h"   // Нашите UUID дефиниции и enum индекси

/*
 * ЛОКАЛНИ ПРОМЕНЛИВИ (UUID масиви)
 ****************************************************************************************
 *
 * UUID (Universally Unique Identifier) = 128-битов уникален идентификатор.
 * Всяка BLE услуга и характеристика има свой UUID.
 * SDK-то очаква указател към тези масиви в GATT таблицата.
 *
 * ВАЖНО: UUID-тата на нашата услуга са произволно генерирани.
 * Те трябва да съвпадат с тези в мобилното приложение!
 */

// UUID на услугата (Service) — "контейнерът" за всички характеристики
static const att_svc_desc128_t custs1_svc1 = DEF_SVC1_UUID_128;

// UUID на всяка характеристика (128-bit)
static const uint8_t SVC1_SET_TIME_UUID_128[ATT_UUID_128_LEN] = DEF_SVC1_SET_TIME_UUID_128;  // SetTime
static const uint8_t SVC1_OUTPUTS_UUID_128[ATT_UUID_128_LEN]  = DEF_SVC1_OUTPUTS_UUID_128;   // Outputs
static const uint8_t SVC1_BUTTONS_UUID_128[ATT_UUID_128_LEN]     = DEF_SVC1_BUTTONS_UUID_128;     // Buttons
static const uint8_t SVC1_TIME_UUID_128[ATT_UUID_128_LEN]        = DEF_SVC1_TIME_UUID_128;        // Time
static const uint8_t SVC1_TEMPERATURE_UUID_128[ATT_UUID_128_LEN] = DEF_SVC1_TEMPERATURE_UUID_128; // Temperature
static const uint8_t SVC1_HUMIDITY_UUID_128[ATT_UUID_128_LEN]    = DEF_SVC1_HUMIDITY_UUID_128;    // Humidity

// Стандартни 16-bit UUID-та (дефинирани от Bluetooth SIG):
static const uint16_t att_decl_svc       = ATT_DECL_PRIMARY_SERVICE;          // 0x2800 = Primary Service
static const uint16_t att_decl_char      = ATT_DECL_CHARACTERISTIC;           // 0x2803 = Characteristic Declaration
static const uint16_t att_desc_cfg       = ATT_DESC_CLIENT_CHAR_CFG;          // 0x2902 = CCCD (за NOTIFY)
static const uint16_t att_desc_user_desc = ATT_DESC_CHAR_USER_DESCRIPTION;    // 0x2901 = User Description

/*
 * ГЛОБАЛНИ ПРОМЕНЛИВИ
 ****************************************************************************************
 * custs1_services: списък с началните индекси на услугите в GATT таблицата.
 * Понеже имаме само 1 услуга, списъкът е: {SVC1_IDX_SVC, CUSTS1_IDX_NB}
 * SDK-то ги ползва за да регистрира услугата при стартиране на BLE стека.
 */
const uint8_t custs1_services[]      = { SVC1_IDX_SVC, CUSTS1_IDX_NB };
const uint8_t custs1_services_size   = ARRAY_LEN(custs1_services) - 1; // Брой услуги = 1
const uint16_t custs1_att_max_nb     = CUSTS1_IDX_NB;                   // Общ брой атрибути = 15

/*
 * GATT БАЗА ДАННИ НА НАШИЯ BLE СЕРВИЗ
 ****************************************************************************************
 *
 * Това е "таблицата" която описва целия ни BLE сервиз.
 * BLE стекът я прочита при старт и създава GATT базата данни.
 *
 * Всяка характеристика се състои от 2-4 реда в таблицата:
 *   1) Declaration (att_decl_char) — описва свойствата (READ/WRITE/NOTIFY)
 *   2) Value — самите данни, които се четат/пишат/нотифицират
 *   3) CCCD (само при NOTIFY) — телефонът записва 0x0001 за да включи notifications
 *   4) User Description (по желание) — текстово име, видимо в nRF Connect
 *
 * Всеки ред е структура attm_desc_128 с полета:
 *   { UUID указател, UUID дължина, Права (PERM), Max размер, Начален размер, Начални данни }
 *
 * КРИТИЧНО: Индексите [SVC1_IDX_...] ТРЯБВА да съвпадат с enum-а в user_custs1_def.h!
 */
const struct attm_desc_128 custs1_att_db[CUSTS1_IDX_NB] =
{
    /*******************************************************************************
     * КОНФИГУРАЦИЯ НА УСЛУГА 1 (Service 1)
     * Съдържа 6 характеристики: SetTime, Outputs, Buttons, Time, Temperature, Humidity
     ******************************************************************************/

    // ═══════════════════════════════════════════════════════════════
    // [0] ДЕКЛАРАЦИЯ НА УСЛУГАТА (Primary Service)
    // Това казва на телефона: "тук започва нова BLE услуга с UUID..."
    // ═══════════════════════════════════════════════════════════════
    [SVC1_IDX_SVC] = {
        (uint8_t*)&att_decl_svc,       // UUID = 0x2800 (Primary Service)
        ATT_UUID_16_LEN,               // UUID дължина = 2 байта (стандартен 16-bit)
        PERM(RD, ENABLE),              // Правá = може да се чете
        sizeof(custs1_svc1),           // Max размер = 16 байта (128-bit UUID на услугата)
        sizeof(custs1_svc1),           // Начален размер = 16 байта
        (uint8_t*)&custs1_svc1         // Данни = нашият Service UUID
    },

    // ═══════════════════════════════════════════════════════════════
    // ХАРАКТЕРИСТИКА: SetTime (WRITE)
    // Телефонът изпраща текст "HH:MM:SS" → ние задаваме вътрешния часовник.
    // Състои се от: Declaration + Value + User Description = 3 записа
    // ═══════════════════════════════════════════════════════════════

    // [1] Декларация — казва на телефона: "следва характеристика с право WRITE"
    [SVC1_IDX_SET_TIME_CHAR] = {
        (uint8_t*)&att_decl_char,      // UUID = 0x2803 (Characteristic Declaration)
        ATT_UUID_16_LEN,               // 16-bit UUID
        PERM(RD, ENABLE),              // Декларацията винаги е READ-only
        0, 0, NULL                     // Няма статични данни — SDK попълва автоматично
    },

    // [2] Стойност — реалните данни (телефонът записва тук)
    [SVC1_IDX_SET_TIME_VAL] = {
        SVC1_SET_TIME_UUID_128,        // Нашият 128-bit UUID за SetTime
        ATT_UUID_128_LEN,              // 128-bit = 16 байта
        PERM(WR, ENABLE) | PERM(WRITE_REQ, ENABLE),  // WRITE с потвърждение
        DEF_SVC1_SET_TIME_CHAR_LEN,    // Max размер = 8 байта ("HH:MM:SS")
        0,                             // Начален размер = 0 (няма начална стойност)
        NULL                           // Няма начални данни
    },

    // [3] Текстово описание — видимо в nRF Connect като "SetTime"
    [SVC1_IDX_SET_TIME_USER_DESC] = {
        (uint8_t*)&att_desc_user_desc, // UUID = 0x2901 (User Description)
        ATT_UUID_16_LEN,               // 16-bit UUID
        PERM(RD, ENABLE),              // Само четене
        sizeof(DEF_SVC1_SET_TIME_USER_DESC) - 1,   // Max = дължина без '\0'
        sizeof(DEF_SVC1_SET_TIME_USER_DESC) - 1,   // Начален = същата дължина
        (uint8_t*)DEF_SVC1_SET_TIME_USER_DESC       // Текст "SetTime"
    },

    // ═══════════════════════════════════════════════════════════════
    // ХАРАКТЕРИСТИКА: Outputs (WRITE)
    // Телефонът изпраща 1 байт маска: bit0=OUT1 (P0_9), bit1=OUT2 (P0_11).
    // Състои се от: Declaration + Value + User Description = 3 записа
    // ═══════════════════════════════════════════════════════════════

    // [4] Декларация
    [SVC1_IDX_OUTPUTS_CHAR] = {
        (uint8_t*)&att_decl_char,      // UUID = 0x2803
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        0, 0, NULL
    },

    // [5] Стойност — 1 байт маска за двата изхода
    [SVC1_IDX_OUTPUTS_VAL] = {
        SVC1_OUTPUTS_UUID_128,         // 128-bit UUID за Outputs
        ATT_UUID_128_LEN,
        PERM(WR, ENABLE) | PERM(WRITE_REQ, ENABLE),  // WRITE с потвърждение
        DEF_SVC1_OUTPUTS_CHAR_LEN,     // Max = 1 байт
        0,
        NULL
    },

    // [6] Текстово описание "Outputs"
    [SVC1_IDX_OUTPUTS_USER_DESC] = {
        (uint8_t*)&att_desc_user_desc,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        sizeof(DEF_SVC1_OUTPUTS_USER_DESC) - 1,
        sizeof(DEF_SVC1_OUTPUTS_USER_DESC) - 1,
        (uint8_t*)DEF_SVC1_OUTPUTS_USER_DESC
    },

    // ═══════════════════════════════════════════════════════════════
    // ХАРАКТЕРИСТИКА: Buttons (NOTIFY)
    // Устройството изпраща 1 байт: bit0=B1 (P0_7), bit1=B2 (P0_6).
    // Телефонът получава стойността автоматично (notification).
    // Състои се от: Declaration + Value + CCCD + User Description = 4 записа
    // ═══════════════════════════════════════════════════════════════

    // [7] Декларация
    [SVC1_IDX_BUTTONS_CHAR] = {
        (uint8_t*)&att_decl_char,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        0, 0, NULL
    },

    // [8] Стойност — 1 байт маска за двата бутона
    //     READ + NOTIFY: телефонът може и да прочете, и да получава updates
    [SVC1_IDX_BUTTONS_VAL] = {
        SVC1_BUTTONS_UUID_128,         // 128-bit UUID за Buttons
        ATT_UUID_128_LEN,
        PERM(RD, ENABLE) | PERM(NTF, ENABLE),  // Четене + Notifications
        DEF_SVC1_BUTTONS_CHAR_LEN,     // Max = 1 байт
        0,
        NULL
    },

    // [9] CCCD (Client Characteristic Configuration Descriptor)
    //     Телефонът записва тук 0x0001 = "включи notifications"
    //     или 0x0000 = "изключи notifications"
    //     Без CCCD телефонът НЕ може да се абонира за notifications!
    [SVC1_IDX_BUTTONS_NTF_CFG] = {
        (uint8_t*)&att_desc_cfg,       // UUID = 0x2902 (CCCD)
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE) | PERM(WR, ENABLE) | PERM(WRITE_REQ, ENABLE),
        sizeof(uint16_t),              // Max = 2 байта (uint16_t)
        0,
        NULL
    },

    // [10] Текстово описание "Buttons"
    [SVC1_IDX_BUTTONS_USER_DESC] = {
        (uint8_t*)&att_desc_user_desc,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        sizeof(DEF_SVC1_BUTTONS_USER_DESC) - 1,
        sizeof(DEF_SVC1_BUTTONS_USER_DESC) - 1,
        (uint8_t*)DEF_SVC1_BUTTONS_USER_DESC
    },

    // ═══════════════════════════════════════════════════════════════
    // ХАРАКТЕРИСТИКА: Time (READ + NOTIFY)
    // Устройството връща текущото време като UTF-8 "HH:MM:SS".
    // READ: телефонът пита → ние отговаряме (динамично чрез handler).
    // NOTIFY: всяка секунда изпращаме ново време (ако е абониран).
    // Състои се от: Declaration + Value + CCCD + User Description = 4 записа
    // ═══════════════════════════════════════════════════════════════

    // [11] Декларация
    [SVC1_IDX_TIME_CHAR] = {
        (uint8_t*)&att_decl_char,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        0, 0, NULL
    },

    // [12] Стойност — "HH:MM:SS" (8 символа)
    //     PERM(RI, ENABLE) = Read Indication → SDK извиква handler при всяко четене
    //     (вместо да връща статична стойност от базата данни)
    [SVC1_IDX_TIME_VAL] = {
        SVC1_TIME_UUID_128,            // 128-bit UUID за Time
        ATT_UUID_128_LEN,
        PERM(RD, ENABLE) | PERM(NTF, ENABLE),        // Четене + Notifications
        PERM(RI, ENABLE) | DEF_SVC1_TIME_CHAR_LEN,   // RI = динамичен READ handler
        0,
        NULL
    },

    // [13] CCCD за Time notifications
    //     Същата логика като Buttons CCCD — телефонът записва 0x0001/0x0000
    [SVC1_IDX_TIME_NTF_CFG] = {
        (uint8_t*)&att_desc_cfg,       // UUID = 0x2902 (CCCD)
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE) | PERM(WR, ENABLE) | PERM(WRITE_REQ, ENABLE),
        sizeof(uint16_t),
        0,
        NULL
    },

    // [14] Текстово описание "Time"
    [SVC1_IDX_TIME_USER_DESC] = {
        (uint8_t*)&att_desc_user_desc,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        sizeof(DEF_SVC1_TIME_USER_DESC) - 1,
        sizeof(DEF_SVC1_TIME_USER_DESC) - 1,
        (uint8_t*)DEF_SVC1_TIME_USER_DESC
    },

    // ═══════════════════════════════════════════════════════════════
    // ХАРАКТЕРИСТИКА: Temperature (READ + NOTIFY)
    // AHT20 температура: 2 байта int16_t ×10 (253 = 25.3°C)
    // ═══════════════════════════════════════════════════════════════

    // [15] Декларация
    [SVC1_IDX_TEMPERATURE_CHAR] = {
        (uint8_t*)&att_decl_char,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        0, 0, NULL
    },

    // [16] Стойност — 2 байта int16_t (little-endian, ×10)
    [SVC1_IDX_TEMPERATURE_VAL] = {
        SVC1_TEMPERATURE_UUID_128,
        ATT_UUID_128_LEN,
        PERM(RD, ENABLE) | PERM(NTF, ENABLE),
        DEF_SVC1_TEMPERATURE_CHAR_LEN,
        0,
        NULL
    },

    // [17] CCCD за Temperature notifications
    [SVC1_IDX_TEMPERATURE_NTF_CFG] = {
        (uint8_t*)&att_desc_cfg,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE) | PERM(WR, ENABLE) | PERM(WRITE_REQ, ENABLE),
        sizeof(uint16_t),
        0,
        NULL
    },

    // [18] Текстово описание "Temperature"
    [SVC1_IDX_TEMPERATURE_USER_DESC] = {
        (uint8_t*)&att_desc_user_desc,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        sizeof(DEF_SVC1_TEMPERATURE_USER_DESC) - 1,
        sizeof(DEF_SVC1_TEMPERATURE_USER_DESC) - 1,
        (uint8_t*)DEF_SVC1_TEMPERATURE_USER_DESC
    },

    // ═══════════════════════════════════════════════════════════════
    // ХАРАКТЕРИСТИКА: Humidity (READ + NOTIFY)
    // AHT20 влажност: 2 байта uint16_t ×10 (487 = 48.7%)
    // ═══════════════════════════════════════════════════════════════

    // [19] Декларация
    [SVC1_IDX_HUMIDITY_CHAR] = {
        (uint8_t*)&att_decl_char,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        0, 0, NULL
    },

    // [20] Стойност — 2 байта uint16_t (little-endian, ×10)
    [SVC1_IDX_HUMIDITY_VAL] = {
        SVC1_HUMIDITY_UUID_128,
        ATT_UUID_128_LEN,
        PERM(RD, ENABLE) | PERM(NTF, ENABLE),
        DEF_SVC1_HUMIDITY_CHAR_LEN,
        0,
        NULL
    },

    // [21] CCCD за Humidity notifications
    [SVC1_IDX_HUMIDITY_NTF_CFG] = {
        (uint8_t*)&att_desc_cfg,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE) | PERM(WR, ENABLE) | PERM(WRITE_REQ, ENABLE),
        sizeof(uint16_t),
        0,
        NULL
    },

    // [22] Текстово описание "Humidity"
    [SVC1_IDX_HUMIDITY_USER_DESC] = {
        (uint8_t*)&att_desc_user_desc,
        ATT_UUID_16_LEN,
        PERM(RD, ENABLE),
        sizeof(DEF_SVC1_HUMIDITY_USER_DESC) - 1,
        sizeof(DEF_SVC1_HUMIDITY_USER_DESC) - 1,
        (uint8_t*)DEF_SVC1_HUMIDITY_USER_DESC
    },
};

/// @} USER_CONFIG
