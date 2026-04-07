/**
 ****************************************************************************************
 *
 * @file user_custs1_def.h
 *
 * @brief Custom Server 1 (CUSTS1) - дефиниции на GATT базата (Service + Characteristics)
 *
 * Този пример е опростен за упражнение:
 *  - 2 бутона -> пращат се към телефона с NOTIFY (Buttons)
 *  - 2 изхода -> командват се от телефона с WRITE (Outputs)
 *  - Часовникът се сверява от телефона с WRITE (SetTime)
 *  - Часовникът може да се чете с READ и (по желание) да се опреснява с NOTIFY (Time)
 *
 ****************************************************************************************
 */

#ifndef _USER_CUSTS1_DEF_H_
#define _USER_CUSTS1_DEF_H_

/**
 ****************************************************************************************
 * @defgroup USER_CONFIG
 * @ingroup USER
 * @brief GATT база данни — UUID-та, дължини, индекси на нашия BLE сервиз.
 * @{
 ****************************************************************************************
 */

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 * attm_db_128.h — дефинира структурата attm_desc_128 и макросите PERM(), ATT_UUID_128_LEN
 * и т.н. Без него не можем да опишем GATT таблицата в .c файла.
 */
#include "attm_db_128.h"

/*
 * DEFINES
 ****************************************************************************************
 *
 * Тук описваме UUID-тата и дължините на данните за нашите характеристики.
 *
 * Важно за начинаещи:
 * - UUID_128: 16 байта уникален идентификатор (Service или Characteristic)
 * - CHAR_LEN: колко байта данни държи "Value"-то на характеристиката
 * - USER_DESC: човешко име, което се вижда в приложения като nRF Connect
 */

// --------------------------
// 1) UUID на услугата (Service)
// --------------------------
// Това е "контейнерът" за нашите характеристики.
#define DEF_SVC1_UUID_128              {0x59, 0x5a, 0x08, 0xe4, 0x86, 0x2a, 0x9e, 0x8f, 0xe9, 0x11, 0xbc, 0x7c, 0x98, 0x43, 0x42, 0x18}

// --------------------------
// 2) UUID-та на характеристиките (Characteristics)
// --------------------------

// SetTime (WRITE): телефонът пише време (epoch seconds) към устройството
#define DEF_SVC1_SET_TIME_UUID_128     {0x60, 0x60, 0x60, 0x60, 0xE1, 0xF0, 0x4A, 0x0C, 0xB3, 0x25, 0xDC, 0x53, 0x6A, 0x68, 0x86, 0x2D}

// Outputs (WRITE): телефонът командва OUT1/OUT2 с 1 байт маска
// bit0 = OUT1, bit1 = OUT2
#define DEF_SVC1_OUTPUTS_UUID_128      {0x01, 0x02, 0x00, 0x00, 0x00, 0x92, 0x42, 0xE6, 0xA8, 0x76, 0xFA, 0x3B, 0xEF, 0xB4, 0x87, 0x5A}

// Buttons (NOTIFY): устройството праща към телефона състояние/събитие от бутоните
// bit0 = Button1, bit1 = Button2
#define DEF_SVC1_BUTTONS_UUID_128      {0xbb, 0xBb, 0xbb, 0xbb, 0xbb, 0x00, 0x00, 0x00, 0x96, 0x33, 0x31, 0xB1, 0x91, 0x59, 0x00, 0x15}

// Time (READ + NOTIFY): телефонът може да прочете текущото време и (по желание) да получава обновяване
#define DEF_SVC1_TIME_UUID_128         {0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xAB, 0xA1, 0xAC, 0x03, 0x1C, 0x2E, 0x0D, 0x29, 0x6C}

// Temperature (READ + NOTIFY): AHT20 температура, int16_t ×10 (253 = 25.3°C)
#define DEF_SVC1_TEMPERATURE_UUID_128  {0xcc, 0xcc, 0xcc, 0xcc, 0xE1, 0xF0, 0x4A, 0x0C, 0xB3, 0x25, 0xDC, 0x53, 0x6A, 0x68, 0x86, 0x2D}

// Humidity (READ + NOTIFY): AHT20 влажност, uint16_t ×10 (487 = 48.7%)
#define DEF_SVC1_HUMIDITY_UUID_128     {0xff, 0xff, 0xff, 0xff, 0xff, 0xF0, 0x4A, 0x0C, 0xB3, 0x25, 0xDC, 0x53, 0x6A, 0x68, 0x86, 0x2D}

// --------------------------
// 3) Дължини на Value полетата (в байтове)
// --------------------------

// SetTime: UTF-8 "HH:MM:SS" max 8 символа
#define DEF_SVC1_SET_TIME_CHAR_LEN     8

// Outputs: 1 байт маска за 2 изхода (OUT1/OUT2)
#define DEF_SVC1_OUTPUTS_CHAR_LEN      1

// Buttons: 1 байт маска за 2 бутона (B1/B2)
#define DEF_SVC1_BUTTONS_CHAR_LEN      1

// Time: 8 символа UTF-8 "HH:MM:SS" (симетрично с SetTime)
#define DEF_SVC1_TIME_CHAR_LEN         8

// Temperature: 2 байта int16_t (×10)
#define DEF_SVC1_TEMPERATURE_CHAR_LEN  2

// Humidity: 2 байта uint16_t (×10)
#define DEF_SVC1_HUMIDITY_CHAR_LEN     2

// --------------------------
// 4) Текстови описания (виждат се в BLE scanner)
// --------------------------
#define DEF_SVC1_SET_TIME_USER_DESC    "Set Time"
#define DEF_SVC1_OUTPUTS_USER_DESC     "Outputs"
#define DEF_SVC1_BUTTONS_USER_DESC     "Buttons"
#define DEF_SVC1_TIME_USER_DESC        "Time"
#define DEF_SVC1_TEMPERATURE_USER_DESC "Temperature"
#define DEF_SVC1_HUMIDITY_USER_DESC    "Humidity"

/*
 * ENUM (индекси на атрибутите в GATT DB)
 ****************************************************************************************
 *
 * МНОГО ВАЖНО за начинаещи:
 * Този enum определя реда на "атрибутите" в таблицата custs1_att_db[] (в .c файла).
 * Всеки characteristic в GATT има няколко елемента:
 *  - *_CHAR      : декларация на характеристиката (properties: READ/WRITE/NOTIFY)
 *  - *_VAL       : реалните данни (value), които се четат/пишат/нотифицират
 *  - *_NTF_CFG   : CCCD поле (Client Characteristic Configuration Descriptor)
 *                 нужно е за NOTIFY (телефонът го включва/изключва)
 *  - *_USER_DESC : текстово описание (по желание, но е удобно)
 *
 * Ако в .c файла не съвпада броят/редът на атрибутите с този enum -> ще имаш проблеми.
 */
enum
{
    // ═══ Услуга (Service) ═══
    SVC1_IDX_SVC = 0,              // [0] Primary Service декларация

    // ═══ SetTime (WRITE) — 3 атрибута ═══
    SVC1_IDX_SET_TIME_CHAR,        // [1] Декларация (свойства: WRITE)
    SVC1_IDX_SET_TIME_VAL,         // [2] Стойност (8 байта "HH:MM:SS")
    SVC1_IDX_SET_TIME_USER_DESC,   // [3] Текстово описание "Set Time"

    // ═══ Outputs (WRITE) — 3 атрибута ═══
    SVC1_IDX_OUTPUTS_CHAR,         // [4] Декларация (свойства: WRITE)
    SVC1_IDX_OUTPUTS_VAL,          // [5] Стойност (1 байт маска)
    SVC1_IDX_OUTPUTS_USER_DESC,    // [6] Текстово описание "Outputs"

    // ═══ Buttons (NOTIFY) — 4 атрибута ═══
    SVC1_IDX_BUTTONS_CHAR,         // [7] Декларация (свойства: READ + NOTIFY)
    SVC1_IDX_BUTTONS_VAL,          // [8] Стойност (1 байт маска)
    SVC1_IDX_BUTTONS_NTF_CFG,      // [9] CCCD — телефонът вкл/изкл notifications
    SVC1_IDX_BUTTONS_USER_DESC,    // [10] Текстово описание "Buttons"

    // ═══ Time (READ + NOTIFY) — 4 атрибута ═══
    SVC1_IDX_TIME_CHAR,            // [11] Декларация (свойства: READ + NOTIFY)
    SVC1_IDX_TIME_VAL,             // [12] Стойност (8 байта "HH:MM:SS", динамичен READ)
    SVC1_IDX_TIME_NTF_CFG,         // [13] CCCD — телефонът вкл/изкл notifications
    SVC1_IDX_TIME_USER_DESC,       // [14] Текстово описание "Time"

    // ═══ Temperature (READ + NOTIFY) — 4 атрибута ═══
    SVC1_IDX_TEMPERATURE_CHAR,     // [15] Декларация
    SVC1_IDX_TEMPERATURE_VAL,      // [16] Стойност (2 байта int16_t ×10)
    SVC1_IDX_TEMPERATURE_NTF_CFG,  // [17] CCCD
    SVC1_IDX_TEMPERATURE_USER_DESC,// [18] Текстово описание "Temperature"

    // ═══ Humidity (READ + NOTIFY) — 4 атрибута ═══
    SVC1_IDX_HUMIDITY_CHAR,        // [19] Декларация
    SVC1_IDX_HUMIDITY_VAL,         // [20] Стойност (2 байта uint16_t ×10)
    SVC1_IDX_HUMIDITY_NTF_CFG,     // [21] CCCD
    SVC1_IDX_HUMIDITY_USER_DESC,   // [22] Текстово описание "Humidity"

    // ═══ Общо ═══
    CUSTS1_IDX_NB                  // = 23 — общ брой атрибути в GATT базата
};

/// @} USER_CONFIG

#endif // _USER_CUSTS1_DEF_H_
