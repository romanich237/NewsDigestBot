# NewsDigestBot

Telegram-бот для автоматического сбора новостей, подготовки постов через ИИ и отправки в личные сообщения, группы и каналы. Node.js, SQLite, настройки в `config.json`, запуск через PM2 или systemd.

> Самостоятельная альтернатива [CraftStick/NewsBot](https://github.com/CraftStick/NewsBot), не форк.
> Репозиторий: [romanich237/NewsDigestBot](https://github.com/romanich237/NewsDigestBot).

## Установка

Нужны Node.js 20 LTS или новее, Git и токен из [BotFather](https://t.me/BotFather). Для сборки SQLite на Ubuntu могут понадобиться `python3 make g++`.

```bash
git clone https://github.com/romanich237/NewsDigestBot.git
cd NewsDigestBot
npm ci
cp config.example.json config.json
```

Заполни `config.json`:

| Настройка | Что указать |
| --- | --- |
| `telegram.bot_token` | Токен бота |
| `telegram.allowed_user_ids` | Свои Telegram ID |
| `telegram.targets` | Получателей и каналы, включённых через `enabled: true` |
| `ai.provider` | `openai`, `google` или `clodex` |
| `openai` / `google_ai` / `clodex` | Ключ и модель выбранного провайдера |
| `news_sources` | RSS и дополнительные новостные API |
| `schedule.timezone` | По умолчанию `Europe/Moscow` |

Для канала добавь бота в администраторы с правом публикации. Для личных сообщений сначала открой бота и отправь `/start`. В `chat_id` укажи числовой ID или `@channelname`.

```bash
npm run validate
npm start
```

База `data.db` создаётся автоматически. Локальный `config.json` и база исключены из Git.

## Возможности

- Сбор новостей из RSS, NewsAPI, GNews, Mediastack и пользовательских JSON-источников.
- Отбор по ключевым словам, исключениям, дате и истории публикаций.
- Генерация через OpenAI, Google Gemini или CLODEX.
- Отдельный пост на каждую новость или общий дайджест.
- Telegram HTML и Rich HTML: ссылки, начертания, цитаты, код, списки и таблицы.
- Отправка по интервалу или cron, ручной запуск из Telegram.
- Статистика API: запросы, токены и оценка стоимости.
- Настройка интервала, футера и режима через Telegram и веб-панель.

## Подключение ИИ

| `ai.provider` | Раздел настроек | Получение ключа |
| --- | --- | --- |
| `openai` | `openai` | [OpenAI Platform](https://platform.openai.com/api-keys) |
| `google` | `google_ai` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `clodex` | `clodex` | [CLODEX](https://clodex.xyz/) |

Также принимаются `chatgpt`, `gemini` и `google_ai`. Выбирается один провайдер. При отсутствии раздела `ai` сохраняется прежний порядок: настроенный Google, затем CLODEX. Автоматического перехода на другой платный API при ошибке нет.

### OpenAI

Добавь или обнови эти разделы в своём конфиге, сохранив остальные настройки:

```json
{
  "ai": {
    "provider": "openai",
    "format": "rich_html"
  },
  "openai": {
    "enabled": true,
    "api_key": "ВАШ_OPENAI_API_KEY",
    "model": "gpt-6-luna",
    "timeout_ms": 90000,
    "max_output_tokens": 8192
  }
}
```

### Google Gemini

Установи `ai.provider: "google"`, затем заполни:

```json
{
  "google_ai": {
    "enabled": true,
    "api_key": "ВАШ_GOOGLE_API_KEY",
    "model": "gemini-2.5-flash-lite",
    "timeout_ms": 90000,
    "max_output_tokens": 8192,
    "temperature": 0.2
  }
}
```

Google вызывается через нативный `generateContent`, OpenAI через `/v1/chat/completions`. Старое поле `google_ai.base_url` больше не используется. Для CLODEX сохранены `base_url`, `temperature` и совместимый endpoint.

После изменения провайдера, ключа или модели перезапусти процесс.

### Бюджетные модели и цены

Проверено 02.11.2026. USD за **1 миллион токенов**, обычная обработка коротких текстовых запросов. Без Batch, инструментов, кэширования и налогов.

| Провайдер / модель | Вход | Выход | Примечание |
| --- | ---: | ---: | --- |
| OpenAI `gpt-6-luna` | $0.10 | $0.50 | Основной бюджетный вариант |
| OpenAI `gpt-5.6-luna` | $0.20 | $1.20 | Предыдущее поколение |
| OpenAI `gpt-5-nano` | $0.05 | $0.40 | Старая модель, Deprecated; проверь доступность |
| Google `gemini-2.5-flash-lite` | $0.10 | $0.40 | Минимальные расходы |
| Google `gemini-3.1-flash-lite` | $0.25 | $1.50 | Более новое поколение |
| Google `gemini-3.5-flash-lite` | $0.30 | $2.50 | Более свежий Flash-Lite |

Для недорогого подключения начни с GPT-6 Luna или Gemini 2.5 Flash-Lite. У остальных вариантов сравнивай обе цены: новая модель не обязательно дешевле.

1000 входных + 1000 выходных токенов стоят примерно $0.0006 у GPT-6 Luna или $0.0005 у Gemini 2.5 Flash-Lite. Рассуждения также могут расходовать выходные токены. У Gemini бывает бесплатная квота с ограничениями модели, региона и проекта.

Официальные источники: [OpenAI](https://developers.openai.com/api/docs/pricing), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano), [Google Gemini](https://ai.google.dev/gemini-api/docs/pricing). Цены CLODEX проверяй по его каталогу.

### Учёт расходов

Запросы записываются в `api_usage` отдельно для `openai`, `google_ai` и `clodex`. Для моделей из таблицы встроены отдельные цены входа и выхода. В Google выход включает thinking tokens. Оценка приблизительная: кэширование, дополнительные инструменты, специальные тарифы и налоги отдельно не рассчитываются.

Для другой модели задай собственные цены:

```json
{
  "monitoring": {
    "openai": {
      "input_usd_per_million": 0.10,
      "output_usd_per_million": 0.50
    },
    "currency": {
      "usd_rub": 90
    }
  }
}
```

Для Google используется раздел `monitoring.google_ai`. Заданные вручную цены имеют приоритет над встроенными, поэтому обновляй их при смене модели. У неизвестной модели без цен оценка равна нулю: это не означает бесплатный API. Для CLODEX по-прежнему доступна общая ставка `monitoring.clodex.usd_per_million_tokens`.

`/api` показывает последние 30 дней. Счётчик локальный, фактические списания проверяй у провайдера. Старые записи, сделанные до разделения провайдеров, автоматически не пересчитываются.

## Форматирование постов

ИИ возвращает обычные `title` и `summary` для совместимости и поле `body_html` с оформленным текстом. Исходная ссылка и название источника добавляются ботом отдельно.

| `ai.format` | Что доступно |
| --- | --- |
| `rich_html` | Ссылки, жирный, курсив, подчёркивание, зачёркивание, спойлеры, цитаты, код, заголовки, списки, таблицы, раскрываемые блоки, сноски и формулы |
| `html` | Обычный Telegram HTML; таблицы предлагаются текстом внутри `<pre>` |

Rich HTML отправляется через `sendRichMessage`. В старом конфиге без `ai.format` используется обычный HTML. Новый пример конфига включает Rich HTML.

```html
<h2>Обновление проекта</h2>
<p><b>Главное</b>, <i>уточнение</i> и <a href="https://example.com">ссылка</a>.</p>
<blockquote>Цитата</blockquote>
<table>
  <tr><th>Параметр</th><th>Значение</th></tr>
  <tr><td>Версия</td><td>1.2</td></tr>
</table>
<details><summary>Подробнее</summary><p>Дополнительный текст</p></details>
```

Текст ИИ ограничен 3500 символами вместе с разметкой; HTML не обрезается посередине. В обычном режиме целое сообщение должно укладываться в 4096 символов: для длинных выпусков выбирай `digest.mode: "single"`.

Telegram проверяет разметку при отправке. При ошибке отправки бот не помечает весь выпуск опубликованным. Отдельные посты, уже отправленные до ошибки, могут повториться при следующем запуске. Пользовательские эмодзи требуют действительных ID и соответствующих прав Telegram.

[Все форматы Telegram](https://core.telegram.org/bots/api#rich-message-formatting-options).

## Источники и отбор

RSS работает без ключей. Дополнительные API включаются отдельно:

| Раздел `news_sources` | Назначение |
| --- | --- |
| `rss_feeds` | Массив адресов RSS |
| `newsapi` | [NewsAPI](https://newsapi.org/) |
| `gnews` | [GNews](https://gnews.io/) |
| `mediastack` | [Mediastack](https://mediastack.com/) |
| `custom` | Пользовательские JSON-источники |

Неиспользуемым сервисам поставь `enabled: false`. Условия бесплатных тарифов проверяй на сайтах провайдеров.

| Поле `digest` | Назначение |
| --- | --- |
| `mode` | `single`: отдельные посты; `digest`: общий выпуск |
| `items_count` | Число новостей |
| `russia_focused`, `international` | Соотношение российских и международных новостей |
| `keywords`, `exclude_keywords` | Темы отбора и исключения |
| `lookback_hours` | Возраст кандидатов |
| `max_candidates_for_llm` | Число материалов для ИИ |
| `max_input_chars_per_item` | Длина входного описания |
| `max_llm_calls_per_run` | Ограничение вызовов при дополнительной обработке |
| `memory_days`, `dedup_similarity` | Хранение истории и порог похожести |
| `inline_url` | Размещение ссылки в обычной карточке |

При ошибке ИИ сохраняется существующий запасной сценарий: повторная обработка отдельных новостей, затем обычные карточки из исходных материалов. Эти дополнительные запросы могут расходовать API-квоту. Текст не выдумывается при отсутствии источников.

## Расписание и получатели

По умолчанию пример задаёт случайный интервал 30–60 минут. Одинаковые `interval_min_minutes` и `interval_max_minutes` дают фиксированный интервал.

Для cron установи оба интервала в 0 и укажи, например:

```json
{
  "schedule": {
    "interval_min_minutes": 0,
    "interval_max_minutes": 0,
    "cron": "0 * * * *",
    "timezone": "Europe/Moscow"
  }
}
```

Включённые `telegram.targets` получают публикации автоматически. Для каждого получателя выпуск собирается отдельно. Бот должен работать в назначенное время.

Футер задаётся через `telegram.footer_text`. Упоминания `@username` превращаются в ссылки. Его также можно поменять в настройках Telegram, отправив `off` для удаления.

## Команды

| Команда | Действие |
| --- | --- |
| `/start` | Краткая справка |
| `/panel` | Панель с кнопками |
| `/preview` | Собрать и отправить выпуск в текущий чат |
| `/digest` | Повторно собрать и отправить выпуск |
| `/api` | Статистика API |

**Предпросмотр отправляет настоящие сообщения.** Команды `npm run preview` и `npm run now` отправляют выпуск первому активному получателю и завершают процесс.

В панели доступны запуск дайджеста, статистика, интервал, футер и ссылка в тексте. Изменение интервала требует перезапуска. `allowed_user_ids` ограничивает проверяемые действия настроек и команду `/api`; текущая версия не применяет этот список ко всем командам и кнопкам.

## PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Выполни команду, которую выведет `pm2 startup`. Процесс: `news-digest-bot`.

```bash
pm2 logs news-digest-bot --lines 100
pm2 restart news-digest-bot
```

## Веб-панель и systemd

Веб-панель включается через `web.enabled`, порт задаётся в `web.port`, пароль в `web.password`. Она показывает статистику, позволяет запустить выпуск и поменять режим, интервал, ссылку и футер.

Для установки на Ubuntu с systemd:

```bash
sudo bash deploy/install.sh
```

Установщик копирует проект в `/opt/news-digest-bot`, создаёт пользователя `newsbot` и сервис `news-digest-bot`. Он также предлагает домен, Nginx и сертификат Let's Encrypt; домен должен указывать на сервер. Используй один менеджер процесса: PM2 или systemd.

```bash
sudo systemctl status news-digest-bot
sudo journalctl -u news-digest-bot -n 100 --no-pager
sudo systemctl restart news-digest-bot
```

## Обновление

Сохрани резервную копию `config.json` и `data.db`, затем из папки проекта:

```bash
git pull --ff-only origin main
npm ci
npm run validate
pm2 restart news-digest-bot
pm2 save
```

Для systemd вместо команд PM2 выполни `sudo systemctl restart news-digest-bot`. При установке в `/opt/news-digest-bot` обновляй файлы именно работающего экземпляра.

Новые разделы настроек переносишь из `config.example.json` в свой конфиг вручную, сохраняя ключи и получателей.

## Если возникла ошибка

| Проблема | Что проверить |
| --- | --- |
| Нет новостей | RSS, ключи источников, фильтры и историю опубликованных материалов |
| API 401/403 | Ключ, разрешения и доступность модели |
| API 429 | Баланс, квоту и частоту запросов |
| Незавершённый ответ | Увеличить `max_output_tokens` или уменьшить число кандидатов и новостей |
| Неверный HTML | Повторить генерацию; при необходимости выбрать `ai.format: "html"` |
| Слишком длинный пост | Режим `single` и более короткое резюме в промпте |
| Нет отправки в канал | `chat_id`, `enabled` и право публикации |
| Цена равна нулю | Наличие цены модели в `monitoring`; это может быть неизвестный тариф |

Проверка конфигурации и синтаксиса:

```bash
npm run validate
node --check src/main.js
node --check src/services/clodex_client.js
node --check src/bot/telegram_sender.js
```

## Структура

| Путь | Назначение |
| --- | --- |
| `src/main.js` | Запуск, расписание, сбор и отправка |
| `src/services/news_fetcher.js` | Источники новостей |
| `src/services/llm_config.js` | Выбор провайдера и тарифы |
| `src/services/clodex_client.js` | Общий клиент OpenAI, Google и CLODEX |
| `src/services/digest_generator.js` | Отбор и генерация |
| `src/services/post_format.js` | Формат ИИ-постов и транспорт Telegram |
| `src/services/api_tracker.js` | Учёт API |
| `src/bot/telegram_sender.js` | Сообщения и Telegram-панель |
| `src/database/db.js` | История, статистика и события SQLite |
| `src/web/server.js` | Веб-панель |
| `prompts/digest_prompt.txt` | Инструкции отбора новостей |
| `config.example.json` | Пример конфигурации |

## Лицензия

MIT с обязательным сохранением исходного указания автора/проекта в исходниках или документации. Полные условия в [LICENSE](LICENSE).

