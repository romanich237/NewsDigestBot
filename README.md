# NewsDigestBot

**NewsDigestBot** — Telegram-бот на Node.js для автоматической подготовки и отправки новостного дайджеста.

> Проект является **альтернативой [CraftStick/NewsBot](https://github.com/CraftStick/NewsBot)**. Это самостоятельная реализация, а не форк.
>
> Репозиторий проекта: **<https://github.com/romanich237/NewsDigestBot>**

## Что изменилось в этой версии

- SQLite-база `data.db` вместо `memory.json`.
- Поддержка нескольких Telegram-назначений: **личные сообщения, группы, супергруппы и каналы**.
- Получатели настраиваются массивом `telegram.targets`.
- `/api` доступна только пользователям из `telegram.allowed_user_ids`.
- Локальный учёт запросов NewsAPI/GNews/Mediastack и CLODEX.
- Учёт `prompt_tokens`, `completion_tokens`, `total_tokens` и ориентировочной стоимости CLODEX в USD и RUB.
- Базовая оценка CLODEX настраивается как **$0.10 за 1 000 000 токенов**; курс USD/RUB также задаётся в `config.json`.
- Config разделён на рабочий `config.json` и шаблон `config.example.json`.
- Без Docker; поддерживаются обычный запуск, systemd и PM2.
- История опубликованных тем хранится в SQLite и не допускает повторение новости в течение заданного окна (по умолчанию 30 дней).

## Структура проекта

```text
news-digest-bot/
├── config.example.json
├── config.json
├── data.db                  # SQLite-база (создаётся автоматически)
├── ecosystem.config.js
├── LICENSE
├── package.json
├── README.md
├── prompts/
│   └── digest_prompt.txt
├── src/
│   ├── main.js
│   ├── utils.js
│   ├── bot/
│   │   ├── api_report.js
│   │   └── telegram_sender.js
│   ├── database/
│   │   └── db.js
│   └── services/
│       ├── api_tracker.js
│       ├── clodex_client.js
│       ├── digest_generator.js
│       └── news_fetcher.js
└── logs/
```

`data.db` не должен коммититься в Git: он добавлен в `.gitignore`.

## Требования

- Node.js 18.18+.
- Telegram Bot Token.
- ID Telegram-пользователя, который будет получать доступ к `/api`.
- ID одного или нескольких чатов/групп/каналов для доставки.
- CLODEX API key и модель — **или** ключ Google AI Studio (альтернативный LLM-провайдер).
- Ключ News API, GNews или Mediastack — только при включении соответствующего источника.

## Получение API-ключей

### CLODEX

Документация: <https://clodex.xyz/docs>

CLODEX указывает OpenAI-compatible endpoint `https://clodex.xyz/v1`; модели и цены необходимо проверять по актуальному каталогу или через авторизованный `/v1/models`.

### Google AI Studio (Gemini) — альтернатива CLODEX

Получение API-ключа: <https://aistudio.google.com/apikey> (кнопка **Create API key**). Ключ начинается с `AIza...`.

Google AI Studio предоставляет OpenAI-совместимый endpoint `https://generativelanguage.googleapis.com/v1beta/openai` — бот работает с ним через тот же клиент, что и с CLODEX. Имя модели — из каталога Gemini (например, `gemini-2.0-flash`). Бесплатный тариф имеет лимиты RPM/RPD; актуальные — на <https://ai.google.dev/pricing>.

### NewsAPI.org

Регистрация/получение ключа: <https://newsapi.org/register>

На текущей странице тарифов Developer указан как бесплатный для разработки/тестирования и с лимитом **100 запросов в день**; сервис отдельно предупреждает, что этот план нельзя использовать в production. Для рабочего/коммерческого использования проверяйте актуальные платные условия. 

Источник тарифов: <https://newsapi.org/pricing>

### GNews

Регистрация: <https://gnews.io/register>

На актуальной странице тарифов Free указан как бесплатный для разработки/тестирования, **100 запросов в день**, до 10 статей на запрос и задержка данных до 12 часов. Free-план предназначен для некоммерческого использования и тестирования. 

Источник тарифов: <https://gnews.io/pricing>

### Mediastack

Регистрация/получение ключа: <https://mediastack.com/signup/free>

На текущей странице тарифов Free указан как бесплатный и включает **100 вызовов в месяц**; также указан non-commercial use и задержка данных. 

Источник тарифов: <https://mediastack.com/pricing>

> Указанные бесплатные лимиты приведены как ориентир для настройки мониторинга. Сервисы могут менять тарифы, ограничения и условия; перед production-использованием проверяйте их официальные страницы.

## Установка

```bash
git clone https://github.com/romanich237/NewsDigestBot.git
cd NewsDigestBot
npm install
```

Создайте рабочий конфиг из шаблона:

```bash
cp config.example.json config.json
```

На Windows PowerShell:

```powershell
Copy-Item config.example.json config.json
```

После этого заполните API-ключи и chat ID: куда вводить ключи — в разделе «Ввод API-ключей в config.json» ниже, chat ID — в разделе «Настройка Telegram».

## Ввод API-ключей в config.json

Все ключи вводятся в файле `config.json` (рабочая копия `config.example.json`). Ниже — точное поле для каждого ключа.

### Telegram Bot Token

Токен выдаёт [@BotFather](https://t.me/BotFather) командой `/newbot` (или `/token` для существующего бота). Вводится в `telegram.bot_token`:

```json
"telegram": {
 "bot_token": "123456789:AA-ваш-токен-от-BotFather"
}
```

### CLODEX API key и модель

Ключ и модель вводятся в блоке `clodex` (получение ключа — см. «Получение API-ключей → CLODEX»):

```json
"clodex": {
 "enabled": true,
 "api_key": "sk-ваш-ключ-clodex",
 "base_url": "https://clodex.xyz/v1",
 "model": "имя-модели-из-каталога"
}
```

### Google AI Studio API key (альтернатива CLODEX)

Если вы хотите использовать Gemini вместо CLODEX, включите блок `google_ai` и отключите `clodex`:

```json
"clodex": {
 "enabled": false
},
"google_ai": {
 "enabled": true,
 "api_key": "AIza...ваш-ключ-из-Google-AI-Studio",
 "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
 "model": "gemini-2.0-flash"
}
```

Правила выбора провайдера:

- Если `google_ai.enabled = true` и `api_key` заполнен (не `YOUR_...`) — используется Google AI Studio.
- Иначе используется блок `clodex`.
- Ключ берётся на <https://aistudio.google.com/apikey>; модель — из каталога Gemini.

### Ключи NewsAPI / GNews / Mediastack (опционально)

Для каждого провайдера в config.json подготовлен свой блок-шаблон с полем ввода api_key — вставьте ключ в нужный блок:

```json
"news_sources": {
 "newsapi": {
 "enabled": true,
 "api_key": "YOUR_NEWSAPI_KEY",
 "categories": ["technology", "science"],
 "language": "ru",
 "country": "ru",
 "page_size":30
 },
 "gnews": {
 "enabled": true,
 "api_key": "YOUR_GNEWS_KEY",
 "categories": ["technology", "science"],
 "language": "ru",
 "country": "ru",
 "page_size":10
 },
 "mediastack": {
 "enabled": true,
 "api_key": "YOUR_MEDIASTACK_KEY",
 "categories": ["technology", "science"],
 "language": "ru",
 "page_size":30
 }
}
```

Правила:

- Блоки со шаблонным значением `YOUR_..._KEY` автоматически пропускаются — заполните только нужный блок, остальные оставьте как есть.
- Поле ввода токена продублировано в `monitoring.free_limits.<сервис>.api_key` — ключ можно вставить и туда; бот возьмёт его, если основной блок не заполнен (приоритет у `news_sources`).
- Несколько заполненных провайдеров работают одновременно, их новости объединяются.
- `"enabled": false` принудительно отключает провайдера.
- `page_size:10` у gnews соответствует бесплатному тарифу (до10 статей за запрос).
- Ключи и тарифы: см. «Получение API-ключей» выше.
- Прежний формат с одним блоком `news_api` и полем `provider` тоже поддерживается.

### Проверка

Проверить, что обязательные поля заполнены:

```bash
node src/main.js --validate
```

Обязательные поля: `telegram.bot_token`, а также `api_key` и `model` активного LLM-провайдера (`clodex` или `google_ai`). Значения с префиксом `YOUR_` считаются незаполненными.

## Настройка Telegram: ЛС, группы и каналы

Вместо старого одиночного `chat_id` используется:

```json
"telegram": {
  "bot_token": "YOUR_BOT_TOKEN",
  "allowed_user_ids": ["123456789"],
  "targets": [
    {
      "name": "Личные сообщения",
      "type": "private",
      "chat_id": "123456789",
      "enabled": true
    },
    {
      "name": "Группа",
      "type": "group",
      "chat_id": "-1001234567890",
      "enabled": true
    },
    {
      "name": "Канал",
      "type": "channel",
      "chat_id": "-1009876543210",
      "enabled": true
    }
  ]
}
```

Можно включить сразу несколько получателей. Планировщик отправляет один готовый дайджест во все `enabled` targets.

Для группы бот должен быть добавлен в группу. Для публикации в канал бот должен быть добавлен в канал с правом публикации сообщений. Команды `/preview`, `/digest` и `/api` рассчитаны прежде всего на личные сообщения и группы; `api` дополнительно защищена `allowed_user_ids`.

## Разрешённый пользователь и `/api`

ID Telegram-пользователя указывается в:

```json
"allowed_user_ids": ["123456789"]
```

Только эти пользователи получают ответ на:

```text
/api
```

Команда показывает:

- количество локально выполненных запросов по сервисам;
- суммарное количество токенов CLODEX;
- `prompt_tokens` и `completion_tokens` в базе;
- примерную стоимость CLODEX в USD;
- примерную стоимость в RUB;
- лимиты бесплатного использования, заданные в `monitoring.free_limits`.

### Как рассчитывается стоимость CLODEX

По умолчанию в конфиге:

```json
"monitoring": {
  "currency": { "usd_rub": 90 },
  "clodex": { "usd_per_million_tokens": 0.1 }
}
```

То есть базовая формула:

```text
USD = total_tokens / 1 000 000 × 0.10
RUB = USD × usd_rub
```

Это **оценка для мониторинга**, а не официальный биллинг CLODEX. Реальные цены и лимиты конкретной модели нужно сверять с актуальным каталогом CLODEX.

## База данных `data.db`

SQLite создаётся автоматически при старте.

Основные таблицы:

- `published_news` — история опубликованных новостей;
- `api_usage` — запросы, токены и оценочная стоимость API;
- `bot_events` — служебные события бота.

История опубликованных тем автоматически очищается после `digest.memory_days` дней.

## Источники новостей

Поддерживаются:

- RSS/Atom через `rss-parser`;
- NewsAPI.org;
- GNews;
- Mediastack;
- произвольные JSON API через `news_sources.custom`.

Пример:

```json
{
  "name": "My API",
  "type": "json",
  "enabled": true,
  "url": "https://example.com/api/news.json",
  "method": "GET",
  "headers": {},
  "items_path": "articles",
  "fields": {
    "title": "title",
    "description": "description",
    "url": "url",
    "published_at": "publishedAt",
    "source": "source.name"
  }
}
```

## Генерация дайджеста

По умолчанию бот подбирает:

- 5 новостей с российской тематикой;
- 1 международную новость.

LLM получает только материалы источников и возвращает JSON с выбранными материалами. HTML, эмодзи и ссылки формируются самим ботом, а не моделью.

Prompt находится отдельно:

```text
prompts/digest_prompt.txt
```

При ошибке CLODEX используется fallback по ключевым словам. Если основной LLM-вызов не отработал, бот способен дополнительно обработать отдельные новости с ограничением `digest.max_llm_calls_per_run`.

## Команды

- `/start` — приветствие и кнопка открытия панели;
- `/panel` — панель управления кнопками;
- `/preview` — собрать дайджест сейчас и отправить в текущий чат;
- `/digest` — пересобрать дайджест и отправить в текущий чат;
- `/api` — статистика API, только для разрешённого пользователя.

## Панель управления (inline-кнопки)

Команда `/panel` (или кнопка из `/start`) открывает меню:

- **📰 Дайджест сейчас** — немедленная сборка и отправка дайджеста в текущий чат;
- **📊 Статистика API** — запросы, токены, оценка стоимости;
- **⚙️ Настройки** — текущие параметры и управление:
 -🔗 ссылка в тексте поста вкл/выкл (мгновенно);
 -⏱ интервал публикации — вводится сообщением: `45` (фиксированный) или `30-60` (случайный в диапазоне); применяется после перезапуска бота;
 -📝 футер поста — любой текст, несколько строк; `off` — удалить. `@username` (например `@cyxapuk_news`) автоматически становится кликабельной ссылкой на Telegram-аккаунт.

Изменения настроек сохраняются в `config.json` и переживают перезапуск.

## Запуск

Проверка конфига:

```bash
node src/main.js --validate
```

Разовый запуск:

```bash
node src/main.js --preview
node src/main.js --now
```

Обычный режим:

```bash
node src/main.js
```

## Режим «одна новость — один пост» (`digest.mode: "single"`)

Вместо единого дайджеста каждая новость публикуется отдельным сообщением по шаблону:

```html
1.🇷🇺 <b>Заголовок новости</b>

Короткое резюме события.

Источник: Example News
```

- «Источник» — кликабельная ссылка на статью (имя источника ведёт на URL);
-🌍 — для международных новостей,🇷🇺 — для российских;
- в конец каждого поста добавляется футер (`telegram.footer_text`), `@username` в нём — кликабельный;
- `digest.mode: "digest"` (по умолчанию) — прежний режим единого дайджеста.

## Веб-панель управления

Встроенный веб-интерфейс (без дополнительных зависимостей, на `node:http`):

- вход по паролю (`web.password`), сессия хранится24 ч;
- статус сервиса и кнопка «Опубликовать дайджест сейчас»;
- настройки: режим публикаций (single/digest), интервал (мин/макс), ссылка в тексте, футер — с сохранением в `config.json`;
- статистика API (запросы, токены, стоимость);
- смена режима/футера/ссылки применяется сразу, смена интервала — после перезапуска сервиса.

Конфиг:

```json
"web": {
 "enabled": true,
 "port":3000,
 "host": "127.0.0.1",
 "domain": "bot.example.com",
 "password": "ваш-пароль"
}
```

### Установка с доменом и SSL (install.sh)

`sudo bash deploy/install.sh` интерактивно спрашивает порт, домен и пароль панели, затем:

1. определяет IP сервера (`api.ipify.org`) и сверяет с A-записью домена (`getent`);
2. при совпадении ставит nginx, создаёт reverse-proxy `домен →127.0.0.1:порт`;
3. выпускает бесплатный сертификат Let's Encrypt: `certbot --nginx -d домен --redirect` (автообновление через `certbot.timer`);
4. записывает блок `web` в `config.json` (панель слушает127.0.0.1, снаружи — только через nginx+SSL).

Если домен не указывает на сервер — установка SSL пропускается с предупреждением (можно продолжить по HTTP).

## Расписание

Пример еженедельной публикации (пятница,18:00):

```json
"schedule": { "cron": "0 18 * * 5", "timezone": "Europe/Moscow" }
```

### Часовой режим (по умолчанию)

Бот собирает новости из интернета каждый час и присылает только новые:

```json
"schedule": { "cron": "0 * * * *", "timezone": "Europe/Moscow" }
```

Особенности:

- Дедупликация по истории в SQLite: уже отправленные новости не повторяются (окно `digest.memory_days`, по умолчанию30 дней).
- Если за час новых материалов не появилось — сообщение не отправляется.
- Рекомендуется уменьшить объём выпуска под часовую частоту, например `digest.items_count =3`, `digest.russia_focused =3`, `digest.international =0`, `digest.lookback_hours =2`.

### Ссылка на статью прямо в тексте

При `digest.inline_url = true` (включено по умолчанию) ссылка на статью добавляется обычным текстом в конец резюме, а не гиперссылкой в заголовке:

```text
1.🇷🇺 Немцам следует готовиться к возможному быстрому началу военного конфликта
Заявил глава вооружённых сил Германии Карстен Бройер… https://example.com/news/123
Источник: Example News
```

При `digest.inline_url = false` заголовок оформляется гиперссылкой (прежнее поведение).

### Подпись-футер под дайджестом

`telegram.footer_text` добавляет произвольную строку в конец каждого дайджеста (например, ссылку на ваш канал):

```json
"telegram": { "footer_text": "🤑 Новости Империи Сухариков (https://t.me/cyxapuk_news)" }
```

Если поле пустое/отсутствует — выводится стандартная служебная строка.

## PM2 24/7

Установите PM2:

```bash
npm install -g pm2
```

Запуск:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

После изменения кода:

```bash
pm2 restart news-digest-bot
```

Логи:

```bash
pm2 logs news-digest-bot
```

## systemd


Автоматическая установка (systemd) — из каталога проекта. Скрипт проверит Node.js, создаст пользователя newsbot, скопирует проект в /opt/news-digest-bot, установит зависимости и зарегистрирует сервис.

```bash
sudo bash deploy/install.sh
```

Ручная установка — пример `/etc/systemd/system/news-digest-bot.service`:

```ini
[Unit]
Description=NewsDigestBot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/news-digest-bot
ExecStart=/usr/bin/node /opt/news-digest-bot/src/main.js
Restart=always
RestartSec=5
User=newsbot

[Install]
WantedBy=multi-user.target
```

Запуск:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now news-digest-bot
sudo systemctl status news-digest-bot
```

## Пример сообщения

```text
📰 NewsDigestBot — дайджест

1. 🇷🇺 [РКН объявил о новых требованиях к ...]
Короткое резюме события.
Источник: Example News

2. 🇷🇺 [Telegram получил новое обновление ...]
Короткое резюме события.
Источник: Example Tech

3. 🇷🇺 [В России изменились правила ...]
Короткое резюме события.
Источник: Example Media

4. 🇷🇺 [Новые меры в сфере IT ...]
Короткое резюме события.
Источник: Example Tech

5. 🇷🇺 [Обновления регулирования интернета ...]
Короткое резюме события.
Источник: Example News

6. 🌍 [International technology news ...]
Короткое резюме события.
Источник: Example World
```

## Лицензия

Проект распространяется по **MIT License с обязательным указанием автора/проекта**. Использовать, изменять и включать проект в другие системы можно, но исходное указание автора/проекта должно сохраняться в исходниках или документации.

Полный текст — в `LICENSE`.