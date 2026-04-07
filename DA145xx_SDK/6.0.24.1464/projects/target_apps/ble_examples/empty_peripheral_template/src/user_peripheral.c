/**
 ****************************************************************************************
 *
 * @file user_peripheral.c
 *
 * @brief ГЛАВНА ЛОГИКА НА ПРИЛОЖЕНИЕТО (BLE Peripheral)
 *
 * Този файл управлява:
 *  - Рекламиране (advertising) — устройството казва "аз съм тук!"
 *  - Свързване (connection) — телефонът се свързва
 *  - Прекъсване на връзката (disconnect) — телефонът се разкачва
 *  - Маршрутизиране на BLE съобщения (message router) — кой handler да обработи данните
 *
 * Нашият потребителски профил:
 *  - Outputs  (WRITE, 1 байт)     → управление на OUT1/OUT2
 *  - SetTime  (WRITE, "HH:MM:SS") → задаване на часовника
 *  - Buttons  (NOTIFY, 1 байт)    → състояние на бутоните
 *  - Time     (READ/NOTIFY, 3B)   → текущо време (H, M, S)
 *
 ****************************************************************************************
 */

/**
 ****************************************************************************************
 * @addtogroup APP
 * @{
 ****************************************************************************************
 */

/*
 * ВКЛЮЧЕНИ ФАЙЛОВЕ (INCLUDES)
 ****************************************************************************************
 */
#include "rwip_config.h"             // Конфигурация на BLE стека (RW-IP = Riviera Waves IP)
#include "gattc_task.h"              // GATT Client задача — за потвърждаване на индикации
#include "gap.h"                     // GAP (Generic Access Profile) — advertising типове
#include "gpio.h"                    // GPIO функции — управление на пинове
#include "app_easy_timer.h"          // Софтуерен таймер (10ms единица)
#include "user_peripheral.h"         // Декларации на нашите функции (този файл)
#include "user_custs1_impl.h"        // Обработчици на нашия BLE сервиз (user_custs1_impl.c)
#include "user_custs1_def.h"         // GATT база данни — UUID, индекси, дължини
#include "user_periph_setup.h"       // GPIO пин дефиниции (BUTTON1_PORT, OUT1_PIN и т.н.)
#include "co_bt.h"                   // Bluetooth константи (GAP_INVALID_CONIDX и др.)
#include "arch_console.h"            // UART printf функции (arch_printf, arch_printf_flush)
#include "user_aht20.h"              // AHT20 сензор — aht20_init()
#include "rf_531.h"                  // RF TX power — rf_pa_pwr_set()

/*
 * ТИПОВЕ ДАННИ
 ****************************************************************************************
 */

// Структура за Manufacturer Specific Data (данни от производителя)
// Вкарва се в advertising пакета — телефоните могат да я видят при сканиране
struct mnf_specific_data_ad_structure
{
    uint8_t ad_structure_size;                          // Размер на тази структура
    uint8_t ad_structure_type;                          // Тип = Manufacturer Specific Data
    uint8_t company_id[APP_AD_MSD_COMPANY_ID_LEN];     // ID на компанията (2 байта)
    uint8_t proprietary_data[APP_AD_MSD_DATA_LEN];     // Наши данни (брояч)
};

/*
 * ГЛОБАЛНИ ПРОМЕНЛИВИ
 ****************************************************************************************
 * __SECTION_ZERO("retention_mem_area0") = "retention memory"
 *   Това е специална RAM област, която ОЦЕЛЯВА при sleep mode.
 *   Когато чипът заспи за пестене на енергия, тези променливи запазват стойността си.
 *   Без retention memory — всички променливи се нулират при събуждане.
 */

uint8_t app_connection_idx                      __SECTION_ZERO("retention_mem_area0"); // Индекс на текущата BLE връзка
timer_hnd app_adv_data_update_timer_used        __SECTION_ZERO("retention_mem_area0"); // Таймер за обновяване на advertising данни
timer_hnd app_param_update_request_timer_used   __SECTION_ZERO("retention_mem_area0"); // Таймер за заявка за промяна на параметри

struct mnf_specific_data_ad_structure mnf_data  __SECTION_ZERO("retention_mem_area0"); // Данни от производителя
uint8_t mnf_data_index                          __SECTION_ZERO("retention_mem_area0"); // Къде в advertising пакета са данните
uint8_t stored_adv_data_len                     __SECTION_ZERO("retention_mem_area0"); // Дължина на advertising данни
uint8_t stored_scan_rsp_data_len                __SECTION_ZERO("retention_mem_area0"); // Дължина на scan response данни
uint8_t stored_adv_data[ADV_DATA_LEN]           __SECTION_ZERO("retention_mem_area0"); // Буфер за advertising данни
uint8_t stored_scan_rsp_data[SCAN_RSP_DATA_LEN] __SECTION_ZERO("retention_mem_area0"); // Буфер за scan response данни

/*
 * FUNCTION DEFINITIONS
 ****************************************************************************************
*/

/**
 ****************************************************************************************
 * @brief Initialize Manufacturer Specific Data
 ****************************************************************************************
 */
static void mnf_data_init()
{
    mnf_data.ad_structure_size = sizeof(struct mnf_specific_data_ad_structure ) - sizeof(uint8_t); // minus the size of the ad_structure_size field
    mnf_data.ad_structure_type = GAP_AD_TYPE_MANU_SPECIFIC_DATA;
    mnf_data.company_id[0] = APP_AD_MSD_COMPANY_ID & 0xFF; // LSB
    mnf_data.company_id[1] = (APP_AD_MSD_COMPANY_ID >> 8 )& 0xFF; // MSB
    mnf_data.proprietary_data[0] = 0;
    mnf_data.proprietary_data[1] = 0;
}

/**
 ****************************************************************************************
 * @brief Update Manufacturer Specific Data
 ****************************************************************************************
 */
static void mnf_data_update()
{
    uint16_t data;

    data = mnf_data.proprietary_data[0] | (mnf_data.proprietary_data[1] << 8);
    data += 1;
    mnf_data.proprietary_data[0] = data & 0xFF;
    mnf_data.proprietary_data[1] = (data >> 8) & 0xFF;

    if (data == 0xFFFF) {
         mnf_data.proprietary_data[0] = 0;
         mnf_data.proprietary_data[1] = 0;
    }
}

/**
 ****************************************************************************************
 * @brief Add an AD structure in the Advertising or Scan Response Data of the
 *        GAPM_START_ADVERTISE_CMD parameter struct.
 * @param[in] cmd               GAPM_START_ADVERTISE_CMD parameter struct
 * @param[in] ad_struct_data    AD structure buffer
 * @param[in] ad_struct_len     AD structure length
 * @param[in] adv_connectable   Connectable advertising event or not. It controls whether
 *                              the advertising data use the full 31 bytes length or only
 *                              28 bytes (Document CCSv6 - Part 1.3 Flags).
 ****************************************************************************************
 */
static void app_add_ad_struct(struct gapm_start_advertise_cmd *cmd, void *ad_struct_data, uint8_t ad_struct_len, uint8_t adv_connectable)
{
    uint8_t adv_data_max_size = (adv_connectable) ? (ADV_DATA_LEN - 3) : (ADV_DATA_LEN);

    if ((adv_data_max_size - cmd->info.host.adv_data_len) >= ad_struct_len)
    {
        // Append manufacturer data to advertising data
        memcpy(&cmd->info.host.adv_data[cmd->info.host.adv_data_len], ad_struct_data, ad_struct_len);

        // Update Advertising Data Length
        cmd->info.host.adv_data_len += ad_struct_len;

        // Store index of manufacturer data which are included in the advertising data
        mnf_data_index = cmd->info.host.adv_data_len - sizeof(struct mnf_specific_data_ad_structure);
    }
    else if ((SCAN_RSP_DATA_LEN - cmd->info.host.scan_rsp_data_len) >= ad_struct_len)
    {
        // Append manufacturer data to scan response data
        memcpy(&cmd->info.host.scan_rsp_data[cmd->info.host.scan_rsp_data_len], ad_struct_data, ad_struct_len);

        // Update Scan Response Data Length
        cmd->info.host.scan_rsp_data_len += ad_struct_len;

        // Store index of manufacturer data which are included in the scan response data
        mnf_data_index = cmd->info.host.scan_rsp_data_len - sizeof(struct mnf_specific_data_ad_structure);
        // Mark that manufacturer data is in scan response and not advertising data
        mnf_data_index |= 0x80;
    }
    else
    {
        // Manufacturer Specific Data do not fit in either Advertising Data or Scan Response Data
        ASSERT_WARNING(0);
    }
    // Store advertising data length
    stored_adv_data_len = cmd->info.host.adv_data_len;
    // Store advertising data
    memcpy(stored_adv_data, cmd->info.host.adv_data, stored_adv_data_len);
    // Store scan response data length
    stored_scan_rsp_data_len = cmd->info.host.scan_rsp_data_len;
    // Store scan_response data
    memcpy(stored_scan_rsp_data, cmd->info.host.scan_rsp_data, stored_scan_rsp_data_len);
}

/**
 ****************************************************************************************
 * @brief Advertisement data update timer callback function.
 ****************************************************************************************
*/
static void adv_data_update_timer_cb()
{
    // If mnd_data_index has MSB set, manufacturer data is stored in scan response
    uint8_t *mnf_data_storage = (mnf_data_index & 0x80) ? stored_scan_rsp_data : stored_adv_data;

    // Update manufacturer data
    mnf_data_update();

    // Update the selected fields of the advertising data (manufacturer data)
    memcpy(mnf_data_storage + (mnf_data_index & 0x7F), &mnf_data, sizeof(struct mnf_specific_data_ad_structure));

    // Update advertising data on the fly
    app_easy_gap_update_adv_data(stored_adv_data, stored_adv_data_len, stored_scan_rsp_data, stored_scan_rsp_data_len);

    // Restart timer for the next advertising update
    app_adv_data_update_timer_used = app_easy_timer(APP_ADV_DATA_UPDATE_TO, adv_data_update_timer_cb);
}

/**
 ****************************************************************************************
 * @brief Parameter update request timer callback function.
 ****************************************************************************************
*/
static void param_update_request_timer_cb()
{
    app_easy_gap_param_update_start(app_connection_idx);
    app_param_update_request_timer_used = EASY_TIMER_INVALID_TIMER;
}

/*
 * ИНИЦИАЛИЗАЦИЯ НА ПРИЛОЖЕНИЕТО
 * ──────────────────────────────
 * Извиква се ВЕДНЪЖ при старт на чипа (преди BLE стекът да е готов).
 * ВНИМАНИЕ: Тук НЕ можем да ползваме app_easy_timer() — BLE стекът не е готов!
 */
void user_app_init(void)
{
    // Маркираме таймера като неактивен
    app_param_update_request_timer_used = EASY_TIMER_INVALID_TIMER;

    // Инициализираме данните на производителя (за advertising пакета)
    mnf_data_init();

    // Копираме advertising данните от конфигурацията в RAM буферите
    memcpy(stored_adv_data, USER_ADVERTISE_DATA, USER_ADVERTISE_DATA_LEN);
    stored_adv_data_len = USER_ADVERTISE_DATA_LEN;
    memcpy(stored_scan_rsp_data, USER_ADVERTISE_SCAN_RESPONSE_DATA, USER_ADVERTISE_SCAN_RESPONSE_DATA_LEN);
    stored_scan_rsp_data_len = USER_ADVERTISE_SCAN_RESPONSE_DATA_LEN;

    // Изключваме двата изхода при старт (за сигурност)
    GPIO_SetInactive(OUT1_PORT, OUT1_PIN);   // OUT1 (P0_9) = LOW
    GPIO_SetInactive(OUT2_PORT, OUT2_PIN);   // OUT2 (P0_11) = LOW

    // ═══ Boot банер по UART ═══
    // ВАЖНО: arch_printf() използва ke_malloc() → heap трябва да е готов.
    // В periph_init() е прекалено рано. Тук (user_app_init) heap-ът вече работи.
#if defined (CFG_PRINTF)
#if defined (__DA14535__)
    arch_printf("\r\n\r\n=== DA14535 BOOT ===\r\n");
#else
    arch_printf("\r\n\r\n=== DA145xx BOOT ===\r\n");
#endif
#if defined (CFG_PRINTF_UART2)
    arch_printf("UART2: P0_%d (TX), P0_%d (RX)\r\n", UART2_TX_PIN, UART2_RX_PIN);
#endif
    arch_printf_flush();
#endif

    // ═══ AHT20 сензор: инициализация ═══
    // I2C е конфигуриран в periph_init().
    // Ако сензорът не е свързан → s_aht20_present = false
    // и tick_timer_cb() няма да прави I2C операции (предотвратява HardFault).
    s_aht20_present = aht20_init();
#if defined (CFG_PRINTF)
    if (s_aht20_present)
        arch_printf("[AHT20] Init OK\r\n");
    else
        arch_printf("[AHT20] Init FAIL\r\n");
    arch_printf_flush();
#endif

    // ═══ RF TX Power: максимална мощност (+4.0 dBm за DA14535) ═══
    // SDK default = 0 dBm (зададен в ble_arp.c → rf_reinit).
    // Задаваме тук СЛЕД rf_reinit, за да override-нем default-а.
    rf_pa_pwr_set(RF_TX_PWR_LVL_PLUS_4d0);
#if defined (CFG_PRINTF)
    arch_printf("[RF] TX power: +4.0 dBm (MAX)\r\n");
    arch_printf_flush();
#endif

    // Извикваме SDK функцията за стандартна инициализация
    default_app_on_init();
}

/*
 * СТАРТИРАНЕ НА РЕКЛАМИРАНЕТО (ADVERTISING)
 * ───────────────────────────────────────────
 * Извиква се когато устройството трябва да започне да "вика":
 *  "Аз съм тук! Свържи се с мен!"
 *
 * Извиква се:
 *  - При първо стартиране (след init)
 *  - При disconnect (телефонът се разкачи → рекламираме отново)
 *  - При отказано advertising (рестарт)
 *
 * ВАЖНО: Тук стартираме и нашия 1-секунден таймер (BLE стекът вече е готов)
 */
void user_app_adv_start(void)
{
    // Стартираме нашия 1-секунден таймер (от user_custs1_impl.c)
    // Тук BLE стекът вече е активен → app_easy_timer() работи
    start_tick_timer();

    // Планираме периодично обновяване на advertising данните
    app_adv_data_update_timer_used = app_easy_timer(APP_ADV_DATA_UPDATE_TO, adv_data_update_timer_cb);

    // Подготвяме advertising команда
    struct gapm_start_advertise_cmd* cmd;
    cmd = app_easy_gap_undirected_advertise_get_active();

    // Добавяме данни от производителя в advertising пакета
    app_add_ad_struct(cmd, &mnf_data, sizeof(struct mnf_specific_data_ad_structure), 1);

    // Стартираме рекламирането!
    app_easy_gap_undirected_advertise_start();
}

/*
 * ТЕЛЕФОНЪТ СЕ СВЪРЗА (CONNECTION)
 * ──────────────────────────────────
 * BLE стекът извиква тази функция когато телефонът се свърже.
 *
 * connection_idx = номер на връзката (0 за първата)
 * param = параметри на връзката (интервал, latency, timeout)
 */
void user_app_connection(uint8_t connection_idx, struct gapc_connection_req_ind const *param)
{
    // Проверяваме дали връзката е валидна
    if (app_env[connection_idx].conidx != GAP_INVALID_CONIDX)
    {
        app_connection_idx = connection_idx;  // Запомняме индекса на връзката
        s_connected = true;                    // Маркираме: "имаме връзка!"

        // ═══ Debug: отпечатваме в UART кога телефонът се свърза ═══
        // idx = номер на BLE връзката (обикновено 0 за първата)
#if defined (CFG_PRINTF)
        arch_printf("\r\n[BLE] CONNECTED (idx=%d)\r\n", connection_idx);
        arch_printf_flush();
#endif

        // Спираме обновяването на advertising (вече не рекламираме)
        app_easy_timer_cancel(app_adv_data_update_timer_used);

        // Проверяваме дали параметрите на връзката са оптимални
        // Ако не са → планираме заявка за промяна след APP_PARAM_UPDATE_REQUEST_TO
        if ((param->con_interval < user_connection_param_conf.intv_min) ||
            (param->con_interval > user_connection_param_conf.intv_max) ||
            (param->con_latency != user_connection_param_conf.latency) ||
            (param->sup_to != user_connection_param_conf.time_out))
        {
            app_param_update_request_timer_used = app_easy_timer(APP_PARAM_UPDATE_REQUEST_TO, param_update_request_timer_cb);
        }
    }
    else
    {
        // Връзката е невалидна → рекламираме отново
        user_app_adv_start();
    }

    // SDK функция за стандартна обработка на свързване
    default_app_on_connection(connection_idx, param);
}

/*
 * ADVERTISING ЗАВЪРШИ (advertising complete)
 * ────────────────────────────────────────────
 * Ако рекламирането е спряно (cancel) → рестартираме го.
 */
void user_app_adv_undirect_complete(uint8_t status)
{
    if (status == GAP_ERR_CANCELED)
    {
        user_app_adv_start();   // Рестарт
    }
}

/*
 * ТЕЛЕФОНЪТ СЕ РАЗКАЧИ (DISCONNECT)
 * ────────────────────────────────────
 * BLE стекът извиква тази функция когато телефонът се разкачи.
 * Причини: телефонът натисна "Disconnect", излезе от обхват, timeout, и т.н.
 */
void user_app_disconnect(struct gapc_disconnect_ind const *param)
{
    s_connected = false;        // Маркираме: "няма връзка"

    // ═══ Debug: отпечатваме в UART кога телефонът се разкачи ═══
    // reason = BLE причина за disconnect (0x13 = Remote User Terminated)
#if defined (CFG_PRINTF)
    arch_printf("\r\n[BLE] DISCONNECTED (reason=0x%02X)\r\n", param->reason);
    arch_printf_flush();
#endif

    // Нулираме notification флаговете — следващият телефон трябва
    // сам да натисне Subscribe, за да получава notifications
    s_buttons_ntf_enabled = false;
    s_time_ntf_enabled    = false;
    s_temp_ntf_enabled    = false;   // AHT20 Temperature NTF
    s_hum_ntf_enabled     = false;   // AHT20 Humidity NTF

    // Спираме таймера за промяна на параметри (няма смисъл без връзка)
    if (app_param_update_request_timer_used != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(app_param_update_request_timer_used);
        app_param_update_request_timer_used = EASY_TIMER_INVALID_TIMER;
    }

    // Обновяваме данните на производителя (брояч +1)
    mnf_data_update();

    // Рекламираме отново — чакаме нова връзка
    user_app_adv_start();
}

/*
 * МАРШРУТИЗАТОР НА BLE СЪОБЩЕНИЯ (Message Router)
 * ─────────────────────────────────────────────────
 * Тази функция е "пощенският служител" на BLE стека.
 * Когато пристигне съобщение, което SDK-то не знае как да обработи,
 * то го изпраща тук. Ние проверяваме типа и го пренасочваме
 * към правилния обработчик.
 *
 * Типове съобщения:
 *   CUSTS1_VAL_WRITE_IND  = телефонът ЗАПИСА нещо (WRITE)
 *   CUSTS1_ATT_INFO_REQ   = BLE стекът пита за размера на характеристика
 *   CUSTS1_VALUE_REQ_IND  = телефонът ЧЕТЕ динамична стойност (READ)
 *   GAPC_PARAM_UPDATED_IND = параметрите на връзката се промениха
 *   GATTC_EVENT_REQ_IND   = непотвърдена индикация (трябва да отговорим)
 */
void user_catch_rest_hndl(ke_msg_id_t const msgid,
                          void const *param,
                          ke_task_id_t const dest_id,
                          ke_task_id_t const src_id)
{
    switch(msgid)
    {
        /* ═══ ТЕЛЕФОНЪТ ЗАПИСА НЕЩО (WRITE) ═══ */
        case CUSTS1_VAL_WRITE_IND:
        {
            // Кастваме param към правилната структура за WRITE
            struct custs1_val_write_ind const *ind = (struct custs1_val_write_ind const *)param;

            // ind->handle = ИНДЕКС на характеристиката (не ATT handle!)
            // Проверяваме КОЯ характеристика е записана
            switch (ind->handle)
            {
                case SVC1_IDX_OUTPUTS_VAL:         // Телефонът управлява изходите
                    user_svc1_outputs_wr_ind_handler(msgid, ind, dest_id, src_id);
                    break;

                case SVC1_IDX_SET_TIME_VAL:        // Телефонът задава часовника
                    user_svc1_set_time_wr_ind_handler(msgid, ind, dest_id, src_id);
                    break;

                case SVC1_IDX_BUTTONS_NTF_CFG:     // Subscribe/Unsubscribe за бутони
                    user_svc1_buttons_cfg_ind_handler(msgid, ind, dest_id, src_id);
                    break;

                case SVC1_IDX_TIME_NTF_CFG:        // Subscribe/Unsubscribe за време
                    user_svc1_time_cfg_ind_handler(msgid, ind, dest_id, src_id);
                    break;

                case SVC1_IDX_TEMPERATURE_NTF_CFG: // Subscribe/Unsubscribe за температура
                    user_svc1_temperature_cfg_ind_handler(msgid, ind, dest_id, src_id);
                    break;

                case SVC1_IDX_HUMIDITY_NTF_CFG:    // Subscribe/Unsubscribe за влажност
                    user_svc1_humidity_cfg_ind_handler(msgid, ind, dest_id, src_id);
                    break;

                default:                            // Непозната характеристика → игнорирай
                    break;
            }
        } break;

        /* ═══ BLE СТЕКЪТ ПИТА ЗА РАЗМЕРА НА ХАРАКТЕРИСТИКА ═══ */
        case CUSTS1_ATT_INFO_REQ:
        {
            struct custs1_att_info_req const *msg_param = (struct custs1_att_info_req const *)param;

            // Всички ATT INFO заявки отиват в един общ обработчик
            user_svc1_rest_att_info_req_handler(msgid, msg_param, dest_id, src_id);
        } break;

        /* ═══ ПАРАМЕТРИТЕ НА ВРЪЗКАТА СЕ ПРОМЕНИХА ═══ */
        case GAPC_PARAM_UPDATED_IND:
        {
            struct gapc_param_updated_ind const *msg_param = (struct gapc_param_updated_ind const *)(param);

            // Проверяваме дали новите параметри съвпадат с предпочитаните
            // Ако да → всичко е наред (празен if блок)
            if ((msg_param->con_interval >= user_connection_param_conf.intv_min) &&
                (msg_param->con_interval <= user_connection_param_conf.intv_max) &&
                (msg_param->con_latency == user_connection_param_conf.latency) &&
                (msg_param->sup_to == user_connection_param_conf.time_out))
            {
                // Параметрите са ОК — нищо не правим
            }
        } break;

        /* ═══ ТЕЛЕФОНЪТ ЧЕТЕ ДИНАМИЧНА СТОЙНОСТ (READ) ═══ */
        case CUSTS1_VALUE_REQ_IND:
        {
            struct custs1_value_req_ind const *msg_param = (struct custs1_value_req_ind const *) param;

            // Коя характеристика се чете?
            switch (msg_param->att_idx)
            {
                case SVC1_IDX_TIME_VAL:            // READ на Time
                {
                    user_svc1_time_read_req_handler(msgid, msg_param, dest_id, src_id);
                } break;

                default:                            // Непозната → връщаме грешка
                {
                    struct custs1_value_req_rsp *rsp = KE_MSG_ALLOC(CUSTS1_VALUE_REQ_RSP,
                                                                    src_id,
                                                                    dest_id,
                                                                    custs1_value_req_rsp);

                    rsp->conidx  = app_env[msg_param->conidx].conidx;
                    rsp->att_idx = msg_param->att_idx;
                    rsp->length = 0;                // Няма данни
                    rsp->status  = ATT_ERR_APP_ERROR; // Грешка: неподдържана характеристика
                    KE_MSG_SEND(rsp);
                } break;
             }
        } break;

        /* ═══ НЕПОТВЪРДЕНА ИНДИКАЦИЯ ═══ */
        case GATTC_EVENT_REQ_IND:
        {
            // ЗАДЪЛЖИТЕЛНО потвърждаване — без него BLE стекът ще изтече (timeout)
            struct gattc_event_ind const *ind = (struct gattc_event_ind const *) param;
            struct gattc_event_cfm *cfm = KE_MSG_ALLOC(GATTC_EVENT_CFM, src_id, dest_id, gattc_event_cfm);
            cfm->handle = ind->handle;  // Потвърждаваме за конкретния handle
            KE_MSG_SEND(cfm);
        } break;

        default:
            break;                      // Непознато съобщение → игнорирай
    }
}

/// @} APP
