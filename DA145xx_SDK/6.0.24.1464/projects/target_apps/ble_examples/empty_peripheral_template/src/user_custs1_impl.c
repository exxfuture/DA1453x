/**
 ****************************************************************************************
 *
 * @file user_custs1_impl.c
 *
 * @brief Обработчици (handlers) за нашия BLE сервиз (Custom Service 1).
 *
 * Този файл съдържа:
 *  - Глобални променливи за състоянието на устройството
 *  - Таймер, който тиква всяка секунда (часовник + четене на бутони)
 *  - Обработчици за BLE съобщения (WRITE, READ, NOTIFY)
 *
 * Как работи BLE комуникацията:
 *  1. Телефонът се свързва с устройството
 *  2. Телефонът може да ПИШЕ (WRITE) в характеристики (SetTime, Outputs)
 *  3. Телефонът може да ЧЕТЕ (READ) характеристики (Time)
 *  4. Устройството може да ПРАЩА (NOTIFY) данни към телефона (Time, Buttons)
 *
 ****************************************************************************************
 */

/* === Стандартни C библиотеки === */
#include <string.h>             // за memcpy() - копиране на памет
#include <stdint.h>             // за uint8_t, uint16_t, uint32_t - типове с точен размер

/* === BLE стек библиотеки === */
#include "ke_msg.h"             // KE_MSG_ALLOC, KE_MSG_SEND - изпращане на съобщения в BLE стека
#include "custs1_task.h"        // Структури и съобщения за Custom Service 1
#include "user_custs1_def.h"    // Нашите дефиниции: UUID-та, индекси, дължини
#include "prf_utils.h"          // prf_get_task_from_id() - намира ID на BLE профил задача
#include "app.h"                // app_env[] - масив с информация за BLE връзките

/* === Хардуерни библиотеки === */
#include "gpio.h"               // GPIO_GetPinStatus, GPIO_SetActive - управление на пинове
#include "user_periph_setup.h"  // BUTTON1_PORT, OUT1_PIN и т.н. - кои пинове ползваме
#include "app_easy_timer.h"     // app_easy_timer() - софтуерен таймер (единица = 10ms)
#include "arch_console.h"       // arch_printf, arch_printf_flush - UART debug
#include "user_aht20.h"         // AHT20 сензор — aht20_trigger_measurement(), aht20_read()
#include "i2c.h"                // i2c_init() — за реинициализация при wake-up (DEBUG)

/*
 * ГЛОБАЛНИ ПРОМЕНЛИВИ ЗА СЪСТОЯНИЕТО
 ****************************************************************************************
 *
 * volatile = казва на компилатора "НЕ оптимизирай тази променлива!"
 *   Без volatile компилаторът може да я махне или кешира в регистър,
 *   и тя няма да се вижда в Watch window на дебъгера.
 *
 * Всички тези променливи могат да се наблюдават в Keil Watch window.
 */

// Дали телефонът е включил notifications за бутоните?
// true = телефонът иска да получава промени на бутоните автоматично
volatile bool     s_buttons_ntf_enabled = false;

// Дали телефонът е включил notifications за часовника?
// true = телефонът иска да получава времето автоматично всяка секунда
volatile bool     s_time_ntf_enabled    = false;

// Вътрешен часовник - брои секунди от 00:00:00 (0) до 23:59:59 (86399)
// Увеличава се с 1 всяка секунда от таймера
volatile uint32_t s_epoch               = 0;

// Последната стойност записана от телефона чрез SetTime
// Запазваме я за справка - да знаем какво е пратил телефонът
volatile uint32_t s_epoch_written       = 0;

// Маска на бутоните: bit0 = Button1, bit1 = Button2
// 0x00 = нищо не е натиснато
// 0x01 = Button1 натиснат
// 0x02 = Button2 натиснат
// 0x03 = и двата натиснати
volatile uint8_t  s_buttons_mask        = 0;

// Маска на изходите: bit0 = OUT1, bit1 = OUT2
// 0x00 = и двата изключени
// 0x01 = OUT1 включен
// 0x02 = OUT2 включен
// 0x03 = и двата включени
volatile uint8_t  s_outputs_mask        = 0;

// Текущо време разбито на часове, минути, секунди
// Изчисляват се от s_epoch всяка секунда
volatile uint8_t  s_hours              = 0;    // 0-23
volatile uint8_t  s_minutes            = 0;    // 0-59
volatile uint8_t  s_seconds            = 0;    // 0-59

// Хендъл (идентификатор) на нашия 1-секунден таймер
// EASY_TIMER_INVALID_TIMER (0) = таймерът не е активен
volatile timer_hnd s_tick_timer        = EASY_TIMER_INVALID_TIMER;

// Дали има активна BLE връзка с телефон?
// true = свързан, false = няма връзка
volatile bool     s_connected          = false;

// ═══ AHT20 сензор: температура и влажност ═══
// Стойностите са × 10 за един знак след запетаята:
//   s_temperature_x10 = 253  → 25.3°C
//   s_humidity_x10    = 487  → 48.7% RH
volatile int16_t  s_temperature_x10    = 0;     // Последна прочетена температура (×10)
volatile uint16_t s_humidity_x10       = 0;     // Последна прочетена влажност (×10)
volatile bool     s_aht20_ready        = false; // true = измерването е стартирано, може да се чете
volatile bool     s_temp_ntf_enabled   = false; // true = телефонът е включил Temperature notifications
volatile bool     s_hum_ntf_enabled    = false; // true = телефонът е включил Humidity notifications
volatile bool     s_aht20_present      = false; // true = AHT20 сензорът е открит и инициализиран

/*
 * ЧЕТЕНЕ НА БУТОНИ ОТ GPIO
 * ─────────────────────────
 * Бутоните са "active-low":
 *   - Когато бутонът НЕ е натиснат → пинът е HIGH (1) заради pull-up резистора
 *   - Когато бутонът Е натиснат → пинът е LOW (0) - свързан към земя (GND)
 *
 * Резултатът се записва в s_buttons_mask:
 *   bit0 (0x01) = Button1 натиснат
 *   bit1 (0x02) = Button2 натиснат
 */
void read_buttons(void)
{
    uint8_t mask = 0;   // Започваме с "нищо не е натиснато"

    // Проверка на Button1 (P0_7):
    // GPIO_GetPinStatus връща 0 ако бутонът е натиснат
    // !0 = true → задаваме bit0
    if (!GPIO_GetPinStatus(BUTTON1_PORT, BUTTON1_PIN))
        mask |= 0x01;   // |= означава "добави бит" без да пипаш другите

    // Проверка на Button2 (P0_6):
    if (!GPIO_GetPinStatus(BUTTON2_PORT, BUTTON2_PIN))
        mask |= 0x02;   // Задаваме bit1

    // Записваме резултата в глобалната променлива
    s_buttons_mask = mask;
}

/*
 * ТАЙМЕР CALLBACK - ИЗВИКВА СЕ ВСЯКА СЕКУНДА
 * ─────────────────────────────────────────────
 * Това е "сърцето" на приложението. Всяка секунда:
 *   1. Увеличава вътрешния часовник (s_epoch)
 *   2. Изчислява часове, минути, секунди
 *   3. Чете бутоните от GPIO
 *   4. AHT20: прочита предишното измерване + стартира ново
 *   5. Изпраща Time notification към телефона (ако е включен)
 *   6. Изпраща Buttons notification към телефона (ако е включен)
 *   7. Рестартира таймера за следващата секунда
 */
void tick_timer_cb(void)
{
    // Таймерът вече е "изтекъл" - маркираме го като невалиден
    // (app_easy_timer е one-shot - изпълнява се веднъж и спира)
    s_tick_timer = EASY_TIMER_INVALID_TIMER;

    /* --- Стъпка 1: Увеличаваме часовника --- */
    s_epoch++;                    // +1 секунда
    if (s_epoch >= 86400)         // 86400 = 24 часа * 60 мин * 60 сек
        s_epoch = 0;              // След 23:59:59 → обратно на 00:00:00

    /* --- Стъпка 2: Изчисляване на часове, минути, секунди --- */
    uint32_t t = s_epoch;         // Копираме в локална променлива за удобство
    s_seconds = t % 60;           // Остатък от деление на 60 = секунди (0-59)
    s_minutes = (t / 60) % 60;    // Делим на 60, после остатък = минути (0-59)
    s_hours   = (t / 3600) % 24;  // Делим на 3600, после остатък = часове (0-23)

    /* --- Стъпка 3: Четем бутоните --- */
    read_buttons();               // Записва резултата в s_buttons_mask

    /* --- Стъпка 4: AHT20 сензор — четене + ново измерване --- */
    // Trigger на тик N → read на тик N+1 (AHT20 нужни ~80ms, 1s е достатъчно)
    if (s_aht20_present)
    {
        if (s_aht20_ready)
        {
            int16_t  temp = 0;
            uint16_t hum  = 0;
            if (aht20_read(&temp, &hum))
            {
                s_temperature_x10 = temp;
                s_humidity_x10    = hum;
#if defined (CFG_PRINTF)
                int16_t t_int = temp / 10;
                int16_t t_dec = temp % 10;
                if (t_dec < 0) t_dec = -t_dec;
                arch_printf("[AHT20] T=%d.%d C  H=%d.%d\r\n",
                            t_int, t_dec, hum / 10, hum % 10);
#endif
            }
        }
        aht20_trigger_measurement();
        s_aht20_ready = true;
    }

    /* --- Стъпка 5: Temperature NOTIFICATION --- */
    if (s_temp_ntf_enabled && s_connected && s_aht20_present)
    {
        struct custs1_val_ntf_ind_req *req = KE_MSG_ALLOC_DYN(CUSTS1_VAL_NTF_REQ,
                                                              prf_get_task_from_id(TASK_ID_CUSTS1),
                                                              TASK_APP,
                                                              custs1_val_ntf_ind_req,
                                                              DEF_SVC1_TEMPERATURE_CHAR_LEN);

        req->handle       = SVC1_IDX_TEMPERATURE_VAL;
        req->length       = DEF_SVC1_TEMPERATURE_CHAR_LEN;
        req->notification = true;
        // int16_t little-endian (×10)
        int16_t t = s_temperature_x10;
        req->value[0] = (uint8_t)(t & 0xFF);
        req->value[1] = (uint8_t)((t >> 8) & 0xFF);

        KE_MSG_SEND(req);
    }

    /* --- Стъпка 6: Humidity NOTIFICATION --- */
    if (s_hum_ntf_enabled && s_connected && s_aht20_present)
    {
        struct custs1_val_ntf_ind_req *req = KE_MSG_ALLOC_DYN(CUSTS1_VAL_NTF_REQ,
                                                              prf_get_task_from_id(TASK_ID_CUSTS1),
                                                              TASK_APP,
                                                              custs1_val_ntf_ind_req,
                                                              DEF_SVC1_HUMIDITY_CHAR_LEN);

        req->handle       = SVC1_IDX_HUMIDITY_VAL;
        req->length       = DEF_SVC1_HUMIDITY_CHAR_LEN;
        req->notification = true;
        // uint16_t little-endian (×10)
        uint16_t h = s_humidity_x10;
        req->value[0] = (uint8_t)(h & 0xFF);
        req->value[1] = (uint8_t)((h >> 8) & 0xFF);

        KE_MSG_SEND(req);
    }

    /* --- Стъпка 7: Time NOTIFICATION --- */
    // Изпращаме само ако: телефонът е включил notifications И има BLE връзка
    if (s_time_ntf_enabled && s_connected)
    {
        // Заделяме памет за BLE съобщ           _DYN = "заподели памет за съобщение + допълнително място за данни"
        //   CUSTS1_VAL_NTF_REQ = тип на съобщението (notification request)
        //   prf_get_task_from_id(TASK_ID_CUSTS1) = получател (BLE профил задачата)
        //   TASK_APP = подател (нашето приложение)
        //   custs1_val_ntf_ind_req = структурата на съобщението
        //   DEF_SVC1_TIME_CHAR_LEN = колко допълнителни байта (3)
        struct custs1_val_ntf_ind_req *req = KE_MSG_ALLOC_DYN(CUSTS1_VAL_NTF_REQ,
                                                              prf_get_task_from_id(TASK_ID_CUSTS1),
                                                              TASK_APP,
                                                              custs1_val_ntf_ind_req,
                                                              DEF_SVC1_TIME_CHAR_LEN);

        req->handle       = SVC1_IDX_TIME_VAL;     // Коя характеристика (Time)
        req->length       = DEF_SVC1_TIME_CHAR_LEN; // 8 символа "HH:MM:SS"
        req->notification = true;                    // Това е notification (не indication)

        // Форматираме времето като UTF-8 текст "HH:MM:SS"
        // '0' = ASCII 0x30, добавяме цифрата за да получим символ
        req->value[0] = '0' + (s_hours   / 10);     // Десетици на часа
        req->value[1] = '0' + (s_hours   % 10);     // Единици на часа
        req->value[2] = ':';                          // Разделител
        req->value[3] = '0' + (s_minutes / 10);     // Десетици на минутите
        req->value[4] = '0' + (s_minutes % 10);     // Единици на минутите
        req->value[5] = ':';                          // Разделител
        req->value[6] = '0' + (s_seconds / 10);     // Десетици на секундите
        req->value[7] = '0' + (s_seconds % 10);     // Единици на секундите

        KE_MSG_SEND(req);                            // Изпращаме към BLE стека
    }

    /* --- Стъпка 8: Buttons NOTIFICATION --- */
    // Същата логика, но за бутоните (1 байт)
    if (s_buttons_ntf_enabled && s_connected)
    {
        struct custs1_val_ntf_ind_req *req = KE_MSG_ALLOC_DYN(CUSTS1_VAL_NTF_REQ,
                                                              prf_get_task_from_id(TASK_ID_CUSTS1),
                                                              TASK_APP,
                                                              custs1_val_ntf_ind_req,
                                                              DEF_SVC1_BUTTONS_CHAR_LEN);

        req->handle       = SVC1_IDX_BUTTONS_VAL;    // Коя характеристика (Buttons)
        req->length       = DEF_SVC1_BUTTONS_CHAR_LEN; // 1 байт
        req->notification = true;
        req->value[0]     = (uint8_t)s_buttons_mask;  // Стойността на бутоните

        KE_MSG_SEND(req);
    }

    /* --- Стъпка 9: Рестартиране на таймера --- */
    // 100 тика × 10ms = 1000ms = 1 секунда
    // tick_timer_cb = функцията която ще се извика отново (рекурсия чрез таймер)
    s_tick_timer = app_easy_timer(100, tick_timer_cb);
}

/*
 * СТАРТИРАНЕ НА 1-СЕКУНДНИЯ ТАЙМЕР
 * ──────────────────────────────────
 * Извиква се при стартиране на BLE advertising (от user_app_adv_start).
 * BLE стекът трябва да е готов преди да можем да ползваме app_easy_timer().
 *
 * Ако таймерът вече тече — първо го спираме, после стартираме нов.
 */
void start_tick_timer(void)
{
    // Ако таймерът вече е активен — спри го, за да не се натрупват
    if (s_tick_timer != EASY_TIMER_INVALID_TIMER)
    {
        app_easy_timer_cancel(s_tick_timer);  // Спира стария таймер
    }
    // Стартирай нов: 100 тика × 10ms = 1 секунда → извикай tick_timer_cb
    s_tick_timer = app_easy_timer(100, tick_timer_cb);
}

/*
 * ИНИЦИАЛИЗАЦИЯ НА СТОЙНОСТИТЕ ПО ПОДРАЗБИРАНЕ
 * ──────────────────────────────────────────────
 * Извиква се при старт на приложението (от user_app_on_init).
 * Нулира всички notification флагове и часовника.
 */
void user_custs1_init_defaults(void)
{
    s_buttons_ntf_enabled = false;  // Notifications за бутони = изключени
    s_time_ntf_enabled    = false;  // Notifications за време = изключени
    s_temp_ntf_enabled    = false;  // Notifications за температура = изключени
    s_hum_ntf_enabled     = false;  // Notifications за влажност = изключени
    s_epoch               = 0;      // Часовник = 00:00:00
}

/*
 * ОБРАБОТЧИК ЗА WRITE НА ИЗХОДИТЕ (Outputs)
 * ────────────────────────────────────────────
 * Телефонът изпраща 1 байт:
 *   bit0 (0x01) → OUT1 пин (P0_9):  1 = включен, 0 = изключен
 *   bit1 (0x02) → OUT2 пин (P0_11): 1 = включен, 0 = изключен
 *
 * Параметрите на ВСЕКИ BLE обработчик:
 *   msgid   = идентификатор на съобщението (не го ползваме)
 *   param   = данните от телефона (стойност + дължина + индекс)
 *   dest_id = кой получава (нашето приложение)
 *   src_id  = кой изпраща (BLE стекът)
 */
void user_svc1_outputs_wr_ind_handler(ke_msg_id_t const msgid,
                                      struct custs1_val_write_ind const *param,
                                      ke_task_id_t const dest_id,
                                      ke_task_id_t const src_id)
{
    // Вземаме първия байт от данните, изпратени от телефона
    uint8_t mask = param->value[0];
    // Записваме в глобалната променлива (за наблюдение в Watch)
    s_outputs_mask = mask;

    // Проверяваме bit0: ако е 1 → включи OUT1, иначе → изключи
    // & = побитово И (AND) - проверява конкретен бит
    if (mask & 0x01)
        GPIO_SetActive(OUT1_PORT, OUT1_PIN);     // HIGH = включен
    else
        GPIO_SetInactive(OUT1_PORT, OUT1_PIN);   // LOW = изключен

    // Проверяваме bit1: ако е 1 → включи OUT2, иначе → изключи
    if (mask & 0x02)
        GPIO_SetActive(OUT2_PORT, OUT2_PIN);
    else
        GPIO_SetInactive(OUT2_PORT, OUT2_PIN);

    // ═══ Debug: отпечатваме в UART какво е записал телефонът ═══
    // mask = байтът от телефона, OUT1/OUT2 = текущото състояние на изходите
#if defined (CFG_PRINTF)
    arch_printf("[BLE] WRITE Outputs: 0x%02X (OUT1=%d OUT2=%d)\r\n",
                mask, (mask & 0x01) ? 1 : 0, (mask & 0x02) ? 1 : 0);
    arch_printf_flush();
#endif

    // (void) = казваме на компилатора "знаем, че не ползваме тези параметри"
    // Без това компилаторът ще даде предупреждение (warning)
    (void)msgid;
    (void)dest_id;
    (void)src_id;
}

/*
 * ОБРАБОТЧИК ЗА WRITE НА SetTime (ЗАДАВАНЕ НА ЧАСОВНИКА)
 * ─────────────────────────────────────────────────────────
 * Телефонът изпраща текст (UTF-8) във формат "HH:MM:SS"
 * Примери: "12:30:00", "9:5:0", "23:59:59"
 *
 * Парсерът (анализаторът) работи така:
 *   1. Чете символ по символ
 *   2. Ако е цифра ('0'-'9') → добавя я към текущото число
 *   3. Ако е ':' → преминава към следващото число
 *   4. Всичко друго се игнорира
 */
void user_svc1_set_time_wr_ind_handler(ke_msg_id_t const msgid,
                                       struct custs1_val_write_ind const *param,
                                       ke_task_id_t const dest_id,
                                       ke_task_id_t const src_id)
{
    // Масив за 3-те числа: [0]=часове, [1]=минути, [2]=секунди
    uint8_t parts[3] = {0, 0, 0};
    // Индекс: кое число пълним в момента (0=часове, 1=минути, 2=секунди)
    uint8_t pidx = 0;
    uint16_t i;  // Брояч за цикъла

    // Обхождаме всеки символ от текста, изпратен от телефона
    // param->length = колко символа е изпратил телефонът
    // pidx < 3 = спираме ако вече имаме 3 числа (H, M, S)
    for (i = 0; i < param->length && pidx < 3; i++)
    {
        uint8_t c = param->value[i];  // Текущият символ (ASCII код)

        // Ако е цифра: ASCII '0'=48, '1'=49, ..., '9'=57
        if (c >= '0' && c <= '9')
        {
            // Формула за "добавяне на цифра":
            // Пример: "12" → first: 0*10 + 1 = 1, then: 1*10 + 2 = 12
            parts[pidx] = parts[pidx] * 10 + (c - '0');
        }
        // Ако е двоеточие → преминаваме към следващото число
        else if (c == ':')
        {
            pidx++;  // 0→1 (часове→минути) или 1→2 (минути→секунди)
        }
        // Всичко друго (интервали, букви и т.н.) се игнорира
    }

    // Извличаме резултатите
    uint8_t h = parts[0];   // Часове
    uint8_t m = parts[1];   // Минути
    uint8_t s = parts[2];   // Секунди

    // Ограничаваме до валидни стойности (clamp)
    // Ако някой изпрати "99:99:99" → ще стане "23:59:59"
    if (h > 23) h = 23;
    if (m > 59) m = 59;
    if (s > 59) s = 59;

    // Записваме в глобалните променливи
    s_hours   = h;
    s_minutes = m;
    s_seconds = s;
    // Изчисляваме epoch (общ брой секунди от 00:00:00)
    // (uint32_t) = cast, за да не стане overflow при умножение
    s_epoch   = (uint32_t)h * 3600 + (uint32_t)m * 60 + (uint32_t)s;
    // Запазваме какво е пратил телефонът (за справка)
    s_epoch_written = s_epoch;

    // ═══ Debug: отпечатваме парснатото време и epoch стойността ═══
    // h:m:s = часове:минути:секунди, epoch = общо секунди от 00:00:00
#if defined (CFG_PRINTF)
    arch_printf("[BLE] WRITE SetTime: %02d:%02d:%02d (epoch=%lu)\r\n",
                h, m, s, (unsigned long)s_epoch);
    arch_printf_flush();
#endif

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}

/*
 * ОБРАБОТЧИК ЗА CCCD НА БУТОНИТЕ
 * ─────────────────────────────────
 * CCCD (Client Characteristic Configuration Descriptor) = "настройка на клиента"
 *
 * Когато телефонът натисне "Subscribe" (синия ↓) в nRF Connect:
 *   → BLE стекът записва 0x0001 в CCCD → извиква тази функция
 * Когато телефонът натисне "Unsubscribe":
 *   → записва 0x0000 → извиква тази функция
 *
 * CCCD е 2 байта (little-endian):
 *   0x0001 = notifications включени
 *   0x0000 = notifications изключени
 */
void user_svc1_buttons_cfg_ind_handler(ke_msg_id_t const msgid,
                                       struct custs1_val_write_ind const *param,
                                       ke_task_id_t const dest_id,
                                       ke_task_id_t const src_id)
{
    // Сглобяваме 16-битова стойност от 2 байта (little-endian):
    // Байт[0] = ниските 8 бита, Байт[1] << 8 = високите 8 бита
    uint16_t cccd = param->value[0] | (param->value[1] << 8);

    // Ако bit0 е 1 → notifications включени, иначе → изключени
    s_buttons_ntf_enabled = (cccd & 0x0001) != 0;

    // ═══ Debug: отпечатваме дали телефонът е включил/изключил Buttons notifications ═══
    // ON = телефонът ще получава промени на бутоните, OFF = спрял е
#if defined (CFG_PRINTF)
    arch_printf("[BLE] Buttons NTF %s\r\n",
                s_buttons_ntf_enabled ? "ON" : "OFF");
    arch_printf_flush();
#endif

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}

/*
 * ОБРАБОТЧИК ЗА CCCD НА ЧАСОВНИКА (Time)
 * ────────────────────────────────────────
 * Абсолютно същата логика като Buttons CCCD, но за Time характеристиката.
 */
void user_svc1_time_cfg_ind_handler(ke_msg_id_t const msgid,
                                    struct custs1_val_write_ind const *param,
                                    ke_task_id_t const dest_id,
                                    ke_task_id_t const src_id)
{
    // Сглобяваме 16-битова стойност от 2 байта (little-endian)
    uint16_t cccd = param->value[0] | (param->value[1] << 8);

    // true ако телефонът е включил notifications за времето
    s_time_ntf_enabled = (cccd & 0x0001) != 0;

    // ═══ Debug: отпечатваме дали телефонът е включил/изключил Time notifications ═══
    // ON = телефонът ще получава времето всяка секунда, OFF = спрял е
#if defined (CFG_PRINTF)
    arch_printf("[BLE] Time NTF %s\r\n",
                s_time_ntf_enabled ? "ON" : "OFF");
    arch_printf_flush();
#endif

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}

/*
 * ОБРАБОТЧИК ЗА CCCD НА ТЕМПЕРАТУРАТА (Temperature)
 */
void user_svc1_temperature_cfg_ind_handler(ke_msg_id_t const msgid,
                                           struct custs1_val_write_ind const *param,
                                           ke_task_id_t const dest_id,
                                           ke_task_id_t const src_id)
{
    uint16_t cccd = param->value[0] | (param->value[1] << 8);
    s_temp_ntf_enabled = (cccd & 0x0001) != 0;

#if defined (CFG_PRINTF)
    arch_printf("[BLE] Temp NTF %s\r\n",
                s_temp_ntf_enabled ? "ON" : "OFF");
    arch_printf_flush();
#endif

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}

/*
 * ОБРАБОТЧИК ЗА CCCD НА ВЛАЖНОСТТА (Humidity)
 */
void user_svc1_humidity_cfg_ind_handler(ke_msg_id_t const msgid,
                                        struct custs1_val_write_ind const *param,
                                        ke_task_id_t const dest_id,
                                        ke_task_id_t const src_id)
{
    uint16_t cccd = param->value[0] | (param->value[1] << 8);
    s_hum_ntf_enabled = (cccd & 0x0001) != 0;

#if defined (CFG_PRINTF)
    arch_printf("[BLE] Hum NTF %s\r\n",
                s_hum_ntf_enabled ? "ON" : "OFF");
    arch_printf_flush();
#endif

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}

/*
 * ОБРАБОТЧИК ЗА ATT INFO (ЗАДЪЛЖИТЕЛЕН)
 * ───────────────────────────────────────
 * BLE стекът пита: "каква е максималната дължина на тази характеристика?"
 * Ние отговаряме с дължината за всяка характеристика.
 *
 * Този handler е ЗАДЪЛЖИТЕЛЕН — без него BLE стекът ще върне грешка
 * и телефонът няма да може да пише/чете.
 *
 * switch/case = проверява коя характеристика е поискана
 */
void user_svc1_rest_att_info_req_handler(ke_msg_id_t const msgid,
                                        struct custs1_att_info_req const *param,
                                        ke_task_id_t const dest_id,
                                        ke_task_id_t const src_id)
{
    // Заделяме памет за отговора (фиксиран размер, без DYN)
    struct custs1_att_info_rsp *rsp =
        KE_MSG_ALLOC(CUSTS1_ATT_INFO_RSP,
                     TASK_ID_CUSTS1,
                     TASK_APP,
                     custs1_att_info_rsp);

    // Копираме информацията от заявката
    rsp->conidx  = param->conidx;           // Индекс на BLE връзката
    rsp->att_idx = param->att_idx;           // Индекс на характеристиката
    rsp->status  = ATT_ERR_NO_ERROR;         // Засега "няма грешка"

    // За всяка характеристика казваме колко байта е дълга
    switch (param->att_idx)
    {
        case SVC1_IDX_OUTPUTS_VAL:            // Outputs = 1 байт (битова маска)
            rsp->length = 1;
            break;

        case SVC1_IDX_SET_TIME_VAL:           // SetTime = 8 байта ("HH:MM:SS")
            rsp->length = DEF_SVC1_SET_TIME_CHAR_LEN;
            break;

        case SVC1_IDX_TIME_VAL:               // Time = 8 символа "HH:MM:SS"
            rsp->length = DEF_SVC1_TIME_CHAR_LEN;
            break;

        case SVC1_IDX_BUTTONS_VAL:            // Buttons = 1 байт (битова маска)
            rsp->length = 1;
            break;

        case SVC1_IDX_TEMPERATURE_VAL:         // Temperature = 2 байта int16_t
            rsp->length = DEF_SVC1_TEMPERATURE_CHAR_LEN;
            break;

        case SVC1_IDX_HUMIDITY_VAL:            // Humidity = 2 байта uint16_t
            rsp->length = DEF_SVC1_HUMIDITY_CHAR_LEN;
            break;

        case SVC1_IDX_BUTTONS_NTF_CFG:        // CCCD дескриптори = 2 байта (0x0000/0x0001)
        case SVC1_IDX_TIME_NTF_CFG:
        case SVC1_IDX_TEMPERATURE_NTF_CFG:
        case SVC1_IDX_HUMIDITY_NTF_CFG:
            rsp->length = 2;
            break;

        default:                              // Непозната характеристика → грешка
            rsp->length = 0;
            rsp->status = ATT_ERR_INVALID_HANDLE;
            break;
    }

    KE_MSG_SEND(rsp);                         // Изпращаме отговора

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}


/*
 * ОБРАБОТЧИК ЗА READ НА ЧАСОВНИКА (Time)
 * ────────────────────────────────────────
 * Когато телефонът натисне ↓ (READ) на Time характеристиката:
 *   1. BLE стекът вижда PERM(RI, ENABLE) → "стойността е динамична"
 *   2. Изпраща CUSTS1_VALUE_REQ_IND до нас
 *   3. Ние изчисляваме текущото време и го връщаме
 *
 * Без PERM(RI, ENABLE) стекът би върнал стара кеширана стойност.
 * С него — всеки READ получава АКТУАЛНО време.
 *
 * Отговор: 3 байта [часове, минути, секунди]
 */
void user_svc1_time_read_req_handler(ke_msg_id_t const msgid,
                                     struct custs1_value_req_ind const *param,
                                     ke_task_id_t const dest_id,
                                     ke_task_id_t const src_id)
{
    // Заделяме памет за отговор с динамична дължина (8 допълнителни байта за "HH:MM:SS")
    struct custs1_value_req_rsp *rsp = KE_MSG_ALLOC_DYN(CUSTS1_VALUE_REQ_RSP,
                                                        prf_get_task_from_id(TASK_ID_CUSTS1),
                                                        TASK_APP,
                                                        custs1_value_req_rsp,
                                                        DEF_SVC1_TIME_CHAR_LEN);

    // Индекс на BLE връзката (кой телефон пита)
    rsp->conidx  = app_env[param->conidx].conidx;
    // Коя характеристика (Time)
    rsp->att_idx = param->att_idx;
    // Дължина = 8 символа "HH:MM:SS"
    rsp->length  = DEF_SVC1_TIME_CHAR_LEN;
    // Няма грешка
    rsp->status  = ATT_ERR_NO_ERROR;

    // Форматираме времето като UTF-8 текст "HH:MM:SS"
    rsp->value[0] = '0' + (s_hours   / 10);     // Десетици на часа
    rsp->value[1] = '0' + (s_hours   % 10);     // Единици на часа
    rsp->value[2] = ':';                          // Разделител
    rsp->value[3] = '0' + (s_minutes / 10);     // Десетици на минутите
    rsp->value[4] = '0' + (s_minutes % 10);     // Единици на минутите
    rsp->value[5] = ':';                          // Разделител
    rsp->value[6] = '0' + (s_seconds / 10);     // Десетици на секундите
    rsp->value[7] = '0' + (s_seconds % 10);     // Единици на секундите

    // ═══ Debug: отпечатваме в UART какво време връщаме при READ заявка ═══
    // Телефонът е натиснал "Read" на Time характеристиката в nRF Connect
#if defined (CFG_PRINTF)
    arch_printf("[BLE] READ Time: %02d:%02d:%02d\r\n",
                (uint8_t)s_hours, (uint8_t)s_minutes, (uint8_t)s_seconds);
    arch_printf_flush();
#endif

    // Изпращаме отговора обратно на BLE стека → телефонът получава данните
    KE_MSG_SEND(rsp);

    (void)msgid;
    (void)dest_id;
    (void)src_id;
}