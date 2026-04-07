/**
 ****************************************************************************************
 *
 * @file user_config.h
 *
 * @brief User configuration file.
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

#ifndef _USER_CONFIG_H_
#define _USER_CONFIG_H_

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */

#include "app_user_config.h"        // Типове и структури за потребителска конфигурация
#include "arch_api.h"               // sleep_state_t, ARCH_SLEEP_OFF и т.н.
#include "app_default_handlers.h"   // default_handlers_configuration
#include "app_adv_data.h"           // ADV_TYPE_*, макроси за advertising данни
#include "co_bt.h"                  // BLE константи: GAP_ROLE_*, KEY_LEN и т.н.

/*
 * ЛОКАЛНИ ПРОМЕНЛИВИ
 ****************************************************************************************
 */

/*
 ****************************************************************************************
 * АДРЕСАЦИЯ И ПОВЕРИТЕЛНОСТ (Privacy)
 ****************************************************************************************
 * BLE адресът може да бъде:
 * - Public (фиксиран, записан в OTP) — нашият избор
 * - Random Static (генериран при старт)
 * - RPA (Resolvable Private Address — за privacy)
 */
#define USER_CFG_ADDRESS_MODE       APP_CFG_ADDR_PUB      // Публичен BLE адрес (без privacy)

// Режим на Controller Privacy (не ни засяга при APP_CFG_ADDR_PUB)
#define USER_CFG_CNTL_PRIV_MODE     APP_CFG_CNTL_PRIV_MODE_NETWORK


/*
 ****************************************************************************************
 * SLEEP MODE (РЕЖИМ НА ЗАСПИВАНЕ)
 ****************************************************************************************
 * ARCH_SLEEP_OFF          — без заспиване (винаги активен) ← нашият избор
 * ARCH_EXT_SLEEP_ON       — extended sleep (ниска консумация, бавно събуждане)
 * ARCH_EXT_SLEEP_OTP_COPY_ON — extended sleep + копиране от OTP при събуждане
 */
static const sleep_state_t app_default_sleep_mode = ARCH_SLEEP_OFF;

/*
 ****************************************************************************************
 * КОНФИГУРАЦИЯ НА ADVERTISING (рекламиране)
 ****************************************************************************************
 * Устройството изпраща advertising пакети → телефонът ги вижда в BLE скенера.
 */
static const struct advertise_configuration user_adv_conf = {

    .addr_src = APP_CFG_ADDR_SRC(USER_CFG_ADDRESS_MODE),   // Източник на адреса

    // Интервал на advertising (колко често изпращаме пакет)
    // 687.5ms = добър баланс между видимост и консумация
    .intv_min = MS_TO_BLESLOTS(687.5),                    // Мин. интервал
    .intv_max = MS_TO_BLESLOTS(687.5),                    // Макс. интервал

    // Канали за advertising:
    // BLE използва 3 специални канала (37, 38, 39) за advertising.
    // ADV_ALL_CHNLS_EN = ползваме и трите → максимална видимост
    .channel_map = ADV_ALL_CHNLS_EN,

    // Режим на видимост:
    // GAP_GEN_DISCOVERABLE = устройството се вижда от всички BLE скенери
    .mode = GAP_GEN_DISCOVERABLE,

    // Филтър: кой може да сканира и да се свърже?
    // ADV_ALLOW_SCAN_ANY_CON_ANY = всеки (без White List ограничения)
    .adv_filt_policy = ADV_ALLOW_SCAN_ANY_CON_ANY,

    // Адрес на целеви peer (само за directed advertising — не ползваме)
    .peer_addr = {0x1, 0x2, 0x3, 0x4, 0x5, 0x6},
    .peer_addr_type = 0,   // 0 = public адрес
};

/*
 ****************************************************************************************
 * ADVERTISING ДАННИ (какво изпращаме в ефира)
 ****************************************************************************************
 * Телефонът вижда тези данни ОЩЕ ПРЕДИ да се свърже.
 * SDK-то автоматично добавя 3 байта Flags в началото.
 * Ние добавяме:
 *   1) Device Information Service UUID (стандартен 16-bit: 0x180A)
 *   2) Нашия Custom Service UUID (128-bit)
 * Максимум 28 байта за потребителски данни (SDK резервира 3 за Flags).
 */
#define USER_ADVERTISE_DATA         ("\x03"\
                                    ADV_TYPE_COMPLETE_LIST_16BIT_SERVICE_IDS\
                                    ADV_UUID_DEVICE_INFORMATION_SERVICE\
                                    "\x11"\
                                    ADV_TYPE_COMPLETE_LIST_128BIT_SERVICE_IDS\
                                    "\x59\x5A\x08\xE4\x86\x2A\x9E\x8F\xE9\x11\xBC\x7C\x98\x43\x42\x18")

/// Дължина на advertising данните (автоматично изчислена)
#define USER_ADVERTISE_DATA_LEN               (sizeof(USER_ADVERTISE_DATA)-1)

/// Scan Response данни (празни — не ползваме)
#define USER_ADVERTISE_SCAN_RESPONSE_DATA     ""

/// Дължина на Scan Response данните
#define USER_ADVERTISE_SCAN_RESPONSE_DATA_LEN (sizeof(USER_ADVERTISE_SCAN_RESPONSE_DATA)-1)

/*
 ****************************************************************************************
 * ИМЕ НА УСТРОЙСТВОТО (Device Name)
 ****************************************************************************************
 * Телефонът вижда това име в BLE скенера (nRF Connect и др.)
 * Ако има място в advertising данните, SDK-то го добавя автоматично.
 * Максимум 248 символа (BLE спецификация).
 */
#define USER_DEVICE_NAME        "DIALOG-TTT"

/// Дължина на името (без терминиращия '\0')
#define USER_DEVICE_NAME_LEN    (sizeof(USER_DEVICE_NAME)-1)

/*
 ****************************************************************************************
 * GAPM КОНФИГУРАЦИЯ (Generic Access Profile Manager)
 ****************************************************************************************
 * Основни настройки на BLE стека: роля, MTU, адрес, ATT база данни.
 */
static const struct gapm_configuration user_gapm_conf = {
    // Роля: Peripheral (устройство, което адвертайзва и чака връзка)
    .role = GAP_ROLE_PERIPHERAL,

    // MTU (Maximum Transmission Unit) = макс. размер на 1 BLE пакет данни
    // 23 = минималният по BLE стандарт (достатъчен за нашите характеристики)
    .max_mtu = 23,

    // Тип BLE адрес (Public, Random и т.н.)
    .addr_type = APP_CFG_ADDR_TYPE(USER_CFG_ADDRESS_MODE),

    // Период за обновяване на RPA адрес (само при Privacy mode)
    .renew_dur = 15000,    // 15000 * 10ms = 150 секунди

    /***********************
     * Privacy конфигурация (не ползваме)
     ***********************/

    // Статичен адрес: {0,...,0} = SDK генерира автоматично
    .addr = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00},

    // IRK (Identity Resolving Key) — за RPA (не ни засяга)
    .irk = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f},

    /***********************
     * ATT база данни
     ***********************/

    // Bit[5]=1: Service Changed feature включена (GAPM_MASK_ATT_SVC_CHG_EN)
    .att_cfg = GAPM_MASK_ATT_SVC_CHG_EN,

    .gap_start_hdl = 0,    // GAP service handle (0 = автоматично)
    .gatt_start_hdl = 0,   // GATT service handle (0 = автоматично)

    /***********************
     * Data Length Extension (BLE 4.2)
     ***********************/

    .max_mps = 0,          // Максимален MPS (0 = по подразбиране)
    .max_txoctets = 251,   // Макс. TX данни на пакет (251 = BLE 4.2 максимум)
    .max_txtime = 2120,    // Макс. TX време в µs (2120 = за 251 байта)
};

/*
 ****************************************************************************************
 * ПАРАМЕТРИ НА ВРЪЗКАТА (Connection Parameters)
 ****************************************************************************************
 * След свързване, телефонът и устройството обменят данни периодично.
 * Тези параметри определят колко често и колко дълго.
 * Телефонът може да ги промени (Parameter Update Request).
 */
static const struct connection_param_configuration user_connection_param_conf = {
    // Минимален интервал на връзка: 10ms
    // Колко често устройствата комуникират (1 double slot = 1.25ms)
    .intv_min = MS_TO_DOUBLESLOTS(10),

    // Максимален интервал на връзка: 20ms
    .intv_max = MS_TO_DOUBLESLOTS(20),

    // Latency (латентност): колко connection events може да пропусне slave-ът
    // 0 = никакви пропускания → бърз отговор, но по-висока консумация
    .latency = 0,

    // Supervision Timeout: ако няма комуникация за 1250ms → връзката пада
    .time_out = MS_TO_TIMERUNITS(1250),

    // Connection Event Duration: мин. и макс. продължителност на 1 event
    // 0 = SDK решава автоматично
    .ce_len_min = MS_TO_DOUBLESLOTS(0),
    .ce_len_max = MS_TO_DOUBLESLOTS(0),
};

/*
 ****************************************************************************************
 * КОНФИГУРАЦИЯ НА ОБРАБОТЧИЦИТЕ ПО ПОДРАЗБИРАНЕ (Default Handlers)
 ****************************************************************************************
 * SDK предоставя готови обработчици за advertising и security.
 * Тук настройваме тяхното поведение.
 */
static const struct default_handlers_configuration  user_default_hnd_conf = {
    // Advertising сценарий:
    // DEF_ADV_FOREVER = рекламирай безкрайно (докато се свърже телефон)
    // DEF_ADV_WITH_TIMEOUT = спри след advertise_period
    .adv_scenario = DEF_ADV_FOREVER,

    // Период на advertising при DEF_ADV_WITH_TIMEOUT (180000ms = 3 минути)
    .advertise_period = MS_TO_TIMERUNITS(180000),

    // Security сценарий:
    // DEF_SEC_REQ_NEVER = не изискваме криптиране/сдвояване
    // DEF_SEC_REQ_ON_CONNECT = изискваме при всяко свързване
    .security_request_scenario = DEF_SEC_REQ_NEVER
};

/*
 ****************************************************************************************
 * КОНФИГУРАЦИЯ ЗА CENTRAL РОЛЯ (НЕ СЕ ИЗПОЛЗВА)
 ****************************************************************************************
 * Нашето устройство е Peripheral (slave), не Central (master).
 * Тази структура е задължителна от SDK, но стойностите не се използват.
 * Central роля: устройството сканира и инициира връзка (напр. телефон).
 */
static const struct central_configuration user_central_conf = {
    .code = GAPM_CONNECTION_DIRECT,    // Директна връзка (не се ползва)
    .addr_src = APP_CFG_ADDR_SRC(USER_CFG_ADDRESS_MODE),

    .scan_interval = 0x180,    // Интервал на сканиране
    .scan_window = 0x160,      // Прозорец на сканиране

    .con_intv_min = 100,       // Мин. интервал на връзка
    .con_intv_max = 100,       // Макс. интервал на връзка
    .con_latency = 0,          // Латентност
    .superv_to = 0x1F4,        // Supervision timeout

    .ce_len_min = 0,           // Мин. дължина на Connection Event
    .ce_len_max = 0x5,         // Макс. дължина на Connection Event

    /**************************************************************************************
     * Адреси на peer устройства (макс. 8 броя) — не се използват
     **************************************************************************************
     */
    .peer_addr_0 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_0_type = 0,
    .peer_addr_1 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_1_type = 0,
    .peer_addr_2 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_2_type = 0,
    .peer_addr_3 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_3_type = 0,
    .peer_addr_4 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_4_type = 0,
    .peer_addr_5 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_5_type = 0,
    .peer_addr_6 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_6_type = 0,
    .peer_addr_7 = {0x0, 0x0, 0x0, 0x0, 0x0, 0x0}, .peer_addr_7_type = 0,
};

/*
 ****************************************************************************************
 * КОНФИГУРАЦИЯ НА СИГУРНОСТ (Security / Pairing)
 ****************************************************************************************
 * BLE сигурността включва:
 * - Сдвояване (Pairing): обмен на ключове между устройствата
 * - Криптиране: защита на данните по въздуха
 * - IO Capabilities: какъв интерфейс има устройството (дисплей, клавиатура...)
 *
 * В момента: НЯМА сигурност (GAP_AUTH_NONE, GAP_NO_SEC).
 * Всеки телефон може да се свърже и да чете/пише характеристиките.
 */
static const struct security_configuration user_security_conf = {
    // IO възможности: устройството няма дисплей и клавиатура
    #if defined (USER_CFG_FEAT_IO_CAP)
    .iocap          = USER_CFG_FEAT_IO_CAP,
    #else
    .iocap          = GAP_IO_CAP_NO_INPUT_NO_OUTPUT,
    #endif

    // OOB (Out Of Band): допълнителен канал за сигурност (NFC и т.н.) — не ползваме
    #if defined (USER_CFG_FEAT_OOB)
    .oob            = USER_CFG_FEAT_OOB,
    #else
    .oob            = GAP_OOB_AUTH_DATA_NOT_PRESENT,
    #endif

    // Изисквания за автентикация: NONE = без сдвояване
    #if defined (USER_CFG_FEAT_AUTH_REQ)
    .auth           = USER_CFG_FEAT_AUTH_REQ,
    #else
    .auth           = GAP_AUTH_NONE,
    #endif

    // Размер на LTK (Long Term Key): ключ за криптиране
    #if defined (USER_CFG_FEAT_KEY_SIZE)
    .key_size       = USER_CFG_FEAT_KEY_SIZE,
    #else
    .key_size       = KEY_LEN,
    #endif

    // Разпределение на ключове от инициатора (телефона)
    #if defined (USER_CFG_FEAT_INIT_KDIST)
    .ikey_dist      = USER_CFG_FEAT_INIT_KDIST,
    #else
    .ikey_dist      = GAP_KDIST_NONE,
    #endif

    // Разпределение на ключове от респондера (нашето устройство)
    #if defined (USER_CFG_FEAT_RESP_KDIST)
    .rkey_dist      = USER_CFG_FEAT_RESP_KDIST,
    #else
    .rkey_dist      = GAP_KDIST_ENCKEY,
    #endif

    // Минимално ниво на сигурност: GAP_NO_SEC = без криптиране
    #if defined (USER_CFG_FEAT_SEC_REQ)
    .sec_req        = USER_CFG_FEAT_SEC_REQ,
    #else
    .sec_req        = GAP_NO_SEC,
    #endif
};

#endif // _USER_CONFIG_H_
