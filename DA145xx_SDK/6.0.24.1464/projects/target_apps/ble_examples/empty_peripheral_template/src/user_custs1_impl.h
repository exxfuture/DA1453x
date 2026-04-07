/**
 ****************************************************************************************
 *
 * @file user_custs1_impl.h
 *
 * @brief Peripheral project Custom1 Server implementation header file.
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

#ifndef _USER_CUSTS1_IMPL_H_
#define _USER_CUSTS1_IMPL_H_

/**
 ****************************************************************************************
 * @addtogroup APP
 * @ingroup RICOW
 * @brief Декларации на обработчиците за нашия BLE сервиз (Custom Service 1).
 * @{
 ****************************************************************************************
 */

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */

#include "gapc_task.h"                 // GAP Client задача — структури за връзки
#include "gapm_task.h"                 // GAP Manager задача — структури за advertising
#include "custs1_task.h"               // Custom Server 1 — структури за WRITE/READ/NOTIFY

/*
 * ВЪНШНИ ПРОМЕНЛИВИ (EXTERN)
 ****************************************************************************************
 * Тези променливи са дефинирани в user_custs1_impl.c
 * и се ползват от user_peripheral.c (при connect/disconnect).
 */

extern volatile bool s_connected;           // true = има BLE връзка с телефон
extern volatile bool s_buttons_ntf_enabled; // true = телефонът е включил Buttons notifications
extern volatile bool s_time_ntf_enabled;    // true = телефонът е включил Time notifications

// AHT20 сензор — температура и влажност
extern volatile int16_t  s_temperature_x10;  // Последна температура (×10), напр. 253 = 25.3°C
extern volatile uint16_t s_humidity_x10;     // Последна влажност (×10), напр. 487 = 48.7%
extern volatile bool     s_temp_ntf_enabled; // true = телефонът е включил Temperature notifications
extern volatile bool     s_hum_ntf_enabled;  // true = телефонът е включил Humidity notifications
extern volatile bool     s_aht20_present;    // true = AHT20 сензорът е открит и инициализиран

/*
 * ДЕКЛАРАЦИИ НА ФУНКЦИИ
 ****************************************************************************************
 * Реализацията е в user_custs1_impl.c
 */

/// Нулира notification флагове и часовника (извиква се при старт)
void user_custs1_init_defaults(void);

/// Стартира 1-секундния таймер (часовник + четене на бутони)
void start_tick_timer(void);

/**
 * Обработчик за READ на Time характеристиката.
 * Телефонът натиска "Read" в nRF Connect → BLE стекът пита нас
 * → ние връщаме текущото време като UTF-8 "HH:MM:SS" (8 символа).
 */
void user_svc1_time_read_req_handler(ke_msg_id_t const msgid,
                                     struct custs1_value_req_ind const *param,
                                     ke_task_id_t const dest_id,
                                     ke_task_id_t const src_id);

/**
 * Обработчик за WRITE на Outputs характеристиката.
 * Телефонът пише 1 байт маска: bit0=OUT1, bit1=OUT2.
 * Ние включваме/изключваме физическите изходи (P0_9, P0_11).
 */
void user_svc1_outputs_wr_ind_handler(ke_msg_id_t const msgid,
                                      struct custs1_val_write_ind const *param,
                                      ke_task_id_t const dest_id,
                                      ke_task_id_t const src_id);

/**
 * Обработчик за WRITE на SetTime характеристиката.
 * Телефонът пише UTF-8 текст "HH:MM:SS" → ние парсваме и
 * задаваме вътрешния часовник (s_epoch).
 */
void user_svc1_set_time_wr_ind_handler(ke_msg_id_t const msgid,
                                       struct custs1_val_write_ind const *param,
                                       ke_task_id_t const dest_id,
                                       ke_task_id_t const src_id);

/**
 * Обработчик за CCCD на Buttons характеристиката.
 * Когато телефонът натисне Subscribe → CCCD = 0x0001 → s_buttons_ntf_enabled = true.
 * Когато натисне Unsubscribe → CCCD = 0x0000 → s_buttons_ntf_enabled = false.
 */
void user_svc1_buttons_cfg_ind_handler(ke_msg_id_t const msgid,
                                       struct custs1_val_write_ind const *param,
                                       ke_task_id_t const dest_id,
                                       ke_task_id_t const src_id);

/**
 * Обработчик за CCCD на Time характеристиката.
 * Същата логика като Buttons CCCD, но за Time notifications.
 */
void user_svc1_time_cfg_ind_handler(ke_msg_id_t const msgid,
                                    struct custs1_val_write_ind const *param,
                                    ke_task_id_t const dest_id,
                                    ke_task_id_t const src_id);

/**
 * Обработчик за CCCD на Temperature характеристиката.
 */
void user_svc1_temperature_cfg_ind_handler(ke_msg_id_t const msgid,
                                           struct custs1_val_write_ind const *param,
                                           ke_task_id_t const dest_id,
                                           ke_task_id_t const src_id);

/**
 * Обработчик за CCCD на Humidity характеристиката.
 */
void user_svc1_humidity_cfg_ind_handler(ke_msg_id_t const msgid,
                                        struct custs1_val_write_ind const *param,
                                        ke_task_id_t const dest_id,
                                        ke_task_id_t const src_id);

/**
 * Обработчик за ATT INFO заявки (ЗАДЪЛЖИТЕЛЕН).
 * BLE стекът пита: "колко байта е тази характеристика?"
 * Ние отговаряме с дължината за всяка характеристика.
 */
void user_svc1_rest_att_info_req_handler(ke_msg_id_t const msgid,
                                         struct custs1_att_info_req const *param,
                                         ke_task_id_t const dest_id,
                                         ke_task_id_t const src_id);

/// @} APP

#endif // _USER_CUSTS1_IMPL_H_
