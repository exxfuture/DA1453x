/**
 ****************************************************************************************
 *
 * @file user_callback_config.h
 *
 * @brief Callback functions configuration file.
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

#ifndef _USER_CALLBACK_CONFIG_H_
#define _USER_CALLBACK_CONFIG_H_

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */

#include <stdio.h>
#include "app_callback.h"           // Структури за BLE callback-и
#include "app_default_handlers.h"   // SDK default реализации на callback-ите
#include "app_entry_point.h"        // user_catch_rest_hndl() — за custom profile messages
#include "app_prf_types.h"          // prf_func_callbacks за BLE профили
#if (BLE_APP_SEC)
#include "app_bond_db.h"            // Bond база данни (не се ползва в нашия проект)
#endif // (BLE_APP_SEC)
#include "user_peripheral.h"        // Нашите callback-и: user_app_connection, и т.н.

/*
 * МАРШРУТИЗАЦИЯ НА BLE CALLBACK-И
 ****************************************************************************************
 * Тази структура казва на SDK-то:
 * "Когато се случи BLE събитие X → извикай функция Y"
 *
 * NULL = не ни интересува това събитие (SDK-то го игнорира)
 * user_xxx = наша функция (от user_peripheral.c)
 * default_xxx = SDK default реализация
 */

static const struct app_callbacks user_app_callbacks = {
    // ═══ Връзка / Разкачване ═══
    .app_on_connection                  = user_app_connection,        // Телефон се свърза → наш handler
    .app_on_disconnect                  = user_app_disconnect,        // Телефон се разкачи → наш handler
    .app_on_update_params_rejected      = NULL,                      // Параметри отказани — не ни трябва
    .app_on_update_params_complete      = NULL,                      // Параметри обновени — не ни трябва

    // ═══ Конфигурация на устройството ═══
    .app_on_set_dev_config_complete     = default_app_on_set_dev_config_complete,  // SDK default

    // ═══ Advertising завършено ═══
    .app_on_adv_nonconn_complete        = NULL,                      // Non-connectable — не ползваме
    .app_on_adv_undirect_complete       = user_app_adv_undirect_complete,  // Undirected adv timeout → наш handler
    .app_on_adv_direct_complete         = NULL,                      // Directed adv — не ползваме

    // ═══ GATT база данни ═══
    .app_on_db_init_complete            = default_app_on_db_init_complete,  // DB готова → SDK стартира adv

    // ═══ Сканиране (Central mode) — не ползваме ═══
    .app_on_scanning_completed          = NULL,
    .app_on_adv_report_ind              = NULL,

    // ═══ GAP информация ═══
    .app_on_get_dev_name                = default_app_on_get_dev_name,           // Име на устройството
    .app_on_get_dev_appearance          = default_app_on_get_dev_appearance,     // Иконка (Generic)
    .app_on_get_dev_slv_pref_params     = default_app_on_get_dev_slv_pref_params,// Preferred conn params
    .app_on_set_dev_info                = default_app_on_set_dev_info,
    .app_on_data_length_change          = NULL,
    .app_on_update_params_request       = default_app_update_params_request,
    .app_on_generate_static_random_addr = default_app_generate_static_random_addr,
    .app_on_svc_changed_cfg_ind         = NULL,
    .app_on_get_peer_features           = NULL,

#if (BLE_APP_SEC)
    // ═══ Сигурност (Security) — не ползваме в нашия проект ═══
    .app_on_pairing_request             = NULL,
    .app_on_tk_exch                     = NULL,
    .app_on_irk_exch                    = NULL,
    .app_on_csrk_exch                   = NULL,
    .app_on_ltk_exch                    = NULL,
    .app_on_pairing_succeeded           = NULL,
    .app_on_encrypt_ind                 = NULL,
    .app_on_encrypt_req_ind             = NULL,
    .app_on_security_req_ind            = NULL,
    .app_on_addr_solved_ind             = NULL,
    .app_on_addr_resolve_failed         = NULL,
#if !defined (__DA14531_01__) && !defined (__DA14535__)
    .app_on_ral_cmp_evt                 = NULL,   // Resolving Address List — не за DA14535
    .app_on_ral_size_ind                = NULL,
    .app_on_ral_addr_ind                = NULL,
#endif // not for DA14531-01, DA14535
#endif // (BLE_APP_SEC)
};

/*
 * BOND БАЗА ДАННИ (не се ползва — без Security)
 ****************************************************************************************
 */
#if (BLE_APP_SEC)
static const struct app_bond_db_callbacks user_app_bond_db_callbacks = {
    .app_bdb_init                       = NULL,
    .app_bdb_get_size                   = NULL,
    .app_bdb_add_entry                  = NULL,
    .app_bdb_remove_entry               = NULL,
    .app_bdb_search_entry               = NULL,
    .app_bdb_get_number_of_stored_irks  = NULL,
    .app_bdb_get_stored_irks            = NULL,
    .app_bdb_get_device_info_from_slot  = NULL,
    .app_bdb_erase                      = NULL,
};
#endif // (BLE_APP_SEC)

/*
 * ПРИХВАЩАНЕ НА CUSTOM PROFILE СЪОБЩЕНИЯ
 ****************************************************************************************
 * Когато BLE стекът получи WRITE/READ/NOTIFY за нашия custom service,
 * той изпраща съобщение (CUSTS1_VAL_WRITE_IND, CUSTS1_VALUE_REQ_IND и т.н.).
 * Тази дефиниция казва: "пренасочи ги към user_catch_rest_hndl()
 * в user_peripheral.c, който ги маршрутизира към правилния handler."
 */
#define app_process_catch_rest_cb       user_catch_rest_hndl

/*
 * CALLBACK-И НА ГЛАВНИЯ ЦИКЪЛ (Main Loop)
 ****************************************************************************************
 * Извикват се от архитектурата на SDK в определени моменти.
 */
static const struct arch_main_loop_callbacks user_app_main_loop_callbacks = {
    .app_on_init            = user_app_init,   // Извиква се ВЕДНЪЖ при старт → boot banner + tick timer

    // app_on_ble_powered: извиква се когато BLE хардуерът е активен.
    // Внимание: watchdog таймерът се презарежда при събуждане.
    .app_on_ble_powered     = NULL,

    // app_on_system_powered: извиква се когато системата е активна.
    // Същото предупреждение за watchdog-а.
    .app_on_system_powered  = NULL,

    .app_before_sleep       = NULL,    // Преди влизане в sleep mode
    .app_validate_sleep     = NULL,    // Валидиране дали можем да спим
    .app_going_to_sleep     = NULL,    // Влизаме в sleep
    .app_resume_from_sleep  = NULL,    // Събудихме се от sleep
};

/*
 * ОПЕРАЦИЯ ПО ПОДРАЗБИРАНЕ — ADVERTISING
 ****************************************************************************************
 * Когато SDK-то реши да стартира advertising (напр. след DB init),
 * извиква тази функция. Ние пренасочваме към user_app_adv_start().
 */
static const struct default_app_operations user_default_app_operations = {
    .default_operation_adv = user_app_adv_start,
};

/*
 * РЕГИСТРАЦИЯ НА BLE ПРОФИЛИ
 ****************************************************************************************
 * Тук се добавят create/enable функции за SIG профили (Heart Rate, HID и т.н.)
 * Нашият custom profile (CUSTS1) се регистрира автоматично от SDK-то.
 * Затова масивът е празен — само терминатор TASK_ID_INVALID.
 */
static const struct prf_func_callbacks user_prf_funcs[] =
{
    {TASK_ID_INVALID,    NULL, NULL}   // ЗАДЪЛЖИТЕЛЕН терминатор — не премествай!
};

#endif // _USER_CALLBACK_CONFIG_H_
