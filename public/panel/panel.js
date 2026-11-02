"use strict";
const $ = (id) => document.getElementById(id);
let config = {},
  secrets = new Set(),
  csrf = "",
  revision = "",
  current = "overview",
  sequence = 0,
  dirty = false,
  autoSaveTimer,
  testTimer,
  editGeneration = 0,
  saveInFlight = false,
  pendingSave = null;
const invalidJSON = new Set();
const SECTIONS = [
  ["overview", "Обзор", "Состояние и публикации", []],
  [
    "telegram",
    "Telegram",
    "Подключи бота, укажи администраторов и получателей. ID администратора — это твой аккаунт, а ID получателя — чат или канал, куда будут приходить новости.",
    ["telegram"],
  ],
  [
    "ai",
    "Искусственный интеллект",
    "Выбери один провайдер и заполни его ключ и модель. Остальные подключения можно оставить незаполненными. Для своего сервера выбери «Свой API» и введи Base URL.",
    ["ai", "openai", "google_ai", "clodex", "custom"],
  ],
  [
    "news",
    "Источники новостей",
    "RSS работает без API-ключа. Новостные API включай только при наличии ключа. У каждого источника свои ограничения; необязательно подключать все сразу.",
    ["news_sources"],
  ],
  [
    "digest",
    "Содержание постов",
    "Определи темы, количество и глубину обработки. Больше кандидатов и более длинные описания увеличивают расход токенов.",
    ["digest"],
  ],
  [
    "images",
    "Фото к публикациям",
    "Подбирай фотографию по ключевым словам заголовка и текста. Для Unsplash нужен Access Key.",
    ["images"],
  ],
  [
    "schedule",
    "Расписание",
    "Задай интервал в минутах. Одинаковые значения дают фиксированную паузу, разные — случайную. Для cron установи оба интервала в 0.",
    ["schedule"],
  ],
  [
    "updates",
    "Автообновление",
    "Обновление выполняется из выбранной ветки GitHub под PM2/systemd. Проверка не чаще раза в минуту. Настройки и база сохраняются.",
    ["updates"],
  ],
  [
    "monitoring",
    "Цены и лимиты",
    "Это локальный учёт расходов, а не баланс провайдера. Для своего API обязательно укажи отдельные цены входа и выхода за миллион токенов.",
    ["monitoring"],
  ],
  [
    "web",
    "Панель и DuckDNS",
    "Пароль можно сменить здесь. Токен и период обновления DuckDNS можно изменить здесь. Подключение другого домена выполняется через установщик.",
    ["web"],
  ],
];
const META = {
  telegram: [
    "Telegram",
    "Для канала назначь бота администратором с правом публикации. Для личных сообщений сначала отправь ему /start.",
  ],
  bot_token: [
    "Токен бота",
    "Получается в @BotFather командой /newbot. Это секретный ключ вида 123456789:AA…; имя бота вместо токена не подходит.",
  ],
  allowed_user_ids: [
    "Администраторы бота",
    "Твои положительные числовые Telegram ID. Несколько ID введи по одному на строку или через запятую. Не указывай здесь ID канала.",
  ],
  targets: [
    "Получатели публикаций",
    "Добавь канал, группу или личный чат. Каждый включённый получатель получает новости автоматически; выключенный остаётся в настройках.",
  ],
  type: [
    "Тип получателя",
    "Канал: публикации подписчикам. Супергруппа/группа: общий чат. Личные сообщения: твой аккаунт после команды /start.",
  ],
  chat_id: [
    "ID или @имя получателя",
    "Для канала подходит @public_channel или ID вида -1001234567890. Для личных сообщений нужен положительный ID пользователя.",
  ],
  name: [
    "Название для себя",
    "Любое понятное название. Оно помогает различать подключения и не меняет имя канала в Telegram.",
  ],
  enabled: [
    "Включено",
    "Выключенный источник или получатель не используется. Для выбранного ИИ-провайдера включение обязательно.",
  ],
  footer_text: [
    "Подпись под постами",
    "HTML-подпись в конце публикации. Разрешены жирный, курсив, подчёркивание, зачёркивание, код, цитаты и ссылки.",
  ],
  parse_mode: [
    "Формат обычных сообщений",
    "Оставь HTML: бот формирует HTML-разметку. Формат ИИ-постов выбирается отдельно в разделе искусственного интеллекта.",
  ],
  disable_web_page_preview: [
    "Отключить превью ссылок",
    "Если включено, обычные сообщения не будут содержать карточку предпросмотра сайта. Rich Messages обрабатывают ссылки своим способом.",
  ],
  ai: [
    "Выбор провайдера",
    "Одновременно используется одно подключение. Выбери провайдер, затем заполни его раздел ниже.",
  ],
  provider: [
    "Провайдер ИИ",
    "OpenAI и Google используют официальные API. CLODEX — отдельный сервис. «Свой API» подходит для OpenAI-совместимых сервисов и локальных серверов.",
  ],
  format: [
    "Формат ИИ-постов",
    "Rich HTML поддерживает таблицы, заголовки и раскрываемые блоки. Обычный HTML подходит для простых сообщений; таблицы оформляются текстом.",
  ],
  openai: [
    "OpenAI",
    "Нужен API-ключ платформы OpenAI и точный идентификатор доступной модели.",
  ],
  google_ai: [
    "Google Gemini",
    "Ключ создаётся в Google AI Studio. Вызовы идут через нативный API Gemini.",
  ],
  clodex: [
    "CLODEX",
    "Введи ключ, Base URL и модель, доступные у этого сервиса.",
  ],
  custom: [
    "Своё подключение",
    "Здесь можно указать OpenAI-совместимый API. Для пользовательского JSON-источника задаются URL, метод и пути к данным.",
  ],
  base_url: [
    "Base URL сервиса",
    "Базовый адрес API с нужной версией, например https://api.example.com/v1. В своём API также можно указать полный /chat/completions.",
  ],
  api_key: [
    "API-ключ",
    "Секретный ключ выбранного сервиса. Он отправляется серверу только при сохранении и не возвращается в браузер.",
  ],
  model: [
    "Модель",
    "Точный идентификатор из каталога сервиса, например gemini-2.5-flash-lite. Название должно быть доступно по указанному API-ключу.",
  ],
  timeout_ms: [
    "Ожидание ответа, миллисекунды",
    "90000 означает 90 секунд. Слишком маленькое значение может прерывать медленную генерацию.",
  ],
  max_output_tokens: [
    "Максимум выходных токенов",
    "Лимит всего ответа модели, включая все новости и возможные рассуждения. При обрыве JSON увеличь лимит или сократи выпуск.",
  ],
  temperature: [
    "Температура",
    "Меньше — более предсказуемый текст. Для моделей без поддержки температуры оставь параметр незаданным.",
  ],
  token_parameter: [
    "Поле лимита токенов",
    "Большинство совместимых серверов принимает max_tokens; некоторые модели требуют max_completion_tokens. Выбери согласно документации сервиса.",
  ],
  news_sources: [
    "Источники",
    "Бот получает описания из RSS и API; полные тексты по произвольным ссылкам автоматически не скачиваются.",
  ],
  rss_feeds: [
    "RSS-ленты",
    "Полные HTTP(S)-адреса RSS, по одному на строку. Например https://habr.com/ru/rss/all/all/. Ключ не требуется.",
  ],
  newsapi: [
    "NewsAPI",
    "Дополнительный источник новостей. Включи его и укажи собственный API-ключ.",
  ],
  gnews: [
    "GNews",
    "Дополнительный источник. Язык, страна и категории ограничивают получаемую выборку.",
  ],
  mediastack: [
    "Mediastack",
    "API новостей. Доступные языки и квоты зависят от тарифа.",
  ],
  categories: [
    "Категории",
    "Категории API через запятую или по одной на строку, например technology и science. Названия должны поддерживаться сервисом.",
  ],
  language: ["Язык", "Код языка материалов, например ru для русского."],
  country: [
    "Страна",
    "Код страны, например ru. Поддержка зависит от новостного API.",
  ],
  page_size: [
    "Размер выборки",
    "Максимальное число материалов на запрос. Увеличение может расходовать квоту источника.",
  ],
  url: ["URL источника", "Полный HTTP(S)-адрес RSS-ленты или JSON API."],
  method: [
    "HTTP-метод",
    "Обычно GET. Используй POST только если его требует твой источник.",
  ],
  headers: [
    "Заголовки запроса",
    'JSON-объект заголовков: например {"Accept":"application/json"}. Authorization считается секретным полем.',
  ],
  params: [
    "Параметры запроса",
    "JSON-объект параметров API. Не указывай секреты в адресах, доступных посторонним.",
  ],
  items_path: [
    "Путь к списку новостей",
    "Путь внутри JSON-ответа, например articles или data.items.",
  ],
  fields: [
    "Поля JSON-источника",
    "Пути к заголовку, описанию, ссылке и времени внутри каждого элемента ответа.",
  ],
  title: [
    "Заголовок",
    "Имя или путь поля заголовка в ответе собственного источника.",
  ],
  description: [
    "Описание",
    "Имя или путь поля короткого описания в JSON-ответе.",
  ],
  published_at: [
    "Время публикации",
    "Имя или путь поля даты в JSON-ответе источника.",
  ],
  source: ["Источник", "Имя или путь поля названия издания в JSON-ответе."],
  digest: ["Выпуск", "Настройки общего выпуска и отдельных публикаций."],
  mode: [
    "Режим публикации",
    "«Отдельные посты»: каждая новость отдельным сообщением. «Дайджест»: все новости одним сообщением.",
  ],
  items_count: [
    "Всего новостей",
    "Сумма российских и международных новостей должна совпадать с этим числом.",
  ],
  russia_focused: [
    "Российских новостей",
    "Сколько материалов, связанных с Россией, включать в выпуск.",
  ],
  international: [
    "Международных новостей",
    "Сколько остальных материалов включать в выпуск.",
  ],
  keywords: [
    "Интересующие темы",
    "Слова и темы для отбора. Они помогают ИИ и локальному фильтру оценить подходящие материалы.",
  ],
  exclude_keywords: [
    "Исключить темы",
    "Материалы с этими словами отбрасываются до генерации.",
  ],
  lookback_hours: [
    "Возраст новостей, часы",
    "Материалы старше этого значения не используются. 48 означает последние двое суток.",
  ],
  max_candidates_for_llm: [
    "Кандидатов передать ИИ",
    "Число свежих материалов в одном запросе. Меньше кандидатов — дешевле обработка, но меньше выбор.",
  ],
  dedup_similarity: [
    "Порог похожести",
    "Значение от 0 до 1. Чем ниже, тем строже отбор похожих заголовков; 0.86 — исходное значение.",
  ],
  memory_days: [
    "История публикаций, дни",
    "Сколько дней хранить сведения о ранее отправленных материалах.",
  ],
  max_llm_calls_per_run: [
    "Максимум вызовов ИИ",
    "Ограничение повторной обработки за выпуск. Запасной сценарий может делать дополнительные платные запросы.",
  ],
  max_input_chars_per_item: [
    "Символов исходника на новость",
    "Какую часть описания передавать модели. Больший объём расходует больше входных токенов.",
  ],
  inline_url: [
    "Ссылка прямо в тексте",
    "Для обычной карточки добавляет открытый URL вместо ссылки в заголовке. Оформленный ИИ-пост сохраняет свои ссылки.",
  ],
  show_source: [
    "Источник и ссылка на статью",
    "Показывает под постом название издания со ссылкой на исходную статью. Выключи, если источник уже указан в тексте.",
  ],
  schedule: ["Расписание", "Время работы считается в заданном часовом поясе."],
  cron: [
    "Cron-выражение",
    "Например 0 * * * * — каждый час. Используется только при минимальном интервале 0.",
  ],
  timezone: [
    "Время расписания",
    "Выбери смещение относительно UTC. Оно используется только для cron-расписания.",
  ],
  interval_min_minutes: [
    "Минимальная пауза, минуты",
    "30 означает не раньше чем через 30 минут. Поставь 0, чтобы использовать cron.",
  ],
  interval_max_minutes: [
    "Максимальная пауза, минуты",
    "Не меньше минимальной. При 30 и 60 бот выбирает случайную паузу в этом диапазоне.",
  ],
  updates: [
    "GitHub-обновления",
    "Проверка и установка новых коммитов. Ручные изменения файлов могут блокировать обновление.",
  ],
  autoInstall: [
    "Устанавливать автоматически",
    "Если выключено, бот только проверяет наличие новой версии.",
  ],
  intervalSeconds: [
    "Проверка каждые, секунды",
    "Минимум 60. Проверка не зависит от расписания публикаций.",
  ],
  repository: [
    "GitHub-репозиторий",
    "Формат owner/name. По умолчанию romanich237/NewsDigestBot.",
  ],
  branch: [
    "Ветка",
    "Обычно main. Для Git-установки должна совпадать с текущей рабочей веткой.",
  ],
  monitoring: [
    "Учёт API",
    "Оценка расходов хранится локально и может отличаться от счёта провайдера.",
  ],
  currency: [
    "Курс валюты",
    "Фиксированный курс для приблизительного перевода расходов в рубли.",
  ],
  usd_rub: [
    "Рублей за доллар",
    "Курс задаётся вручную и не обновляется автоматически.",
  ],
  usd_per_million_tokens: [
    "Цена миллиона токенов, USD",
    "Общая ставка CLODEX, если не заданы разные цены входа и выхода.",
  ],
  input_usd_per_million: [
    "Вход: USD за миллион токенов",
    "Цена отправленных модели данных. Оставь незаданным для встроенной цены известной модели.",
  ],
  output_usd_per_million: [
    "Выход: USD за миллион токенов",
    "Цена сгенерированного ответа. Для собственного API укажи тариф своего провайдера.",
  ],
  free_limits: [
    "Квоты провайдеров",
    "Справочные значения для статистики. Они не изменяют тариф и не гарантируют бесплатные запросы.",
  ],
  requests: [
    "Количество запросов",
    "Справочная квота сервиса на указанный период.",
  ],
  period: [
    "Период квоты",
    "day — день, month — месяц, provider — условия сервиса.",
  ],
  note: ["Примечание", "Пояснение, которое будет видно в статистике API."],
  web: [
    "Доступ к панели",
    "Панель остаётся включённой при сохранении, чтобы не потерять доступ.",
  ],
  domain: [
    "Домен",
    "Адрес, открываемый в браузере. Домен и SSL меняются через установщик.",
  ],
  password: [
    "Новый пароль панели",
    "Оставь пустым, чтобы сохранить пароль. После смены потребуется войти заново.",
  ],
  duckdns: [
    "DuckDNS",
    "Поддерживает привязку поддомена duckdns.org к текущему IPv4 сервера. Сам поддомен сначала создай в своём аккаунте DuckDNS.",
  ],
  token: [
    "Токен DuckDNS",
    "Секретный токен аккаунта с duckdns.org. Он нужен для обновления IP и не показывается после сохранения.",
  ],
  interval_minutes: [
    "Обновлять DNS каждые, минуты",
    "Обычно 5 минут. Проверка выполняется на сервере независимо от генерации новостей.",
  ],
  images: [
    "Фото по ключевым словам",
    "Изображения ищутся по заголовку и описанию. Автор и Unsplash указываются при отправке.",
  ],
  access_key: [
    "Unsplash Access Key",
    "Создай приложение в Unsplash Developers. Ключ скрывается после сохранения.",
  ],
  orientation: [
    "Ориентация фото",
    "Горизонтальная лучше подходит для постов Telegram.",
  ],
  per_post: [
    "Фото для каждого поста",
    "Для отдельных публикаций подбирать своё фото. У дайджеста используется фото первой новости.",
  ],
};
const ENUMS = {
  "ai.provider": [
    ["openai", "OpenAI"],
    ["google", "Google Gemini"],
    ["clodex", "CLODEX"],
    ["custom", "Свой API"],
  ],
  "ai.format": [
    ["rich_html", "Rich HTML — таблицы и блоки"],
    ["html", "Обычный HTML"],
  ],
  "digest.mode": [
    ["single", "Отдельные посты"],
    ["digest", "Общий дайджест"],
  ],
  "telegram.parse_mode": [["HTML", "HTML"]],
  "custom.token_parameter": [
    ["max_tokens", "max_tokens"],
    ["max_completion_tokens", "max_completion_tokens"],
  ],
  "schedule.timezone": window.PanelFields.timezones,
  "images.provider": [["unsplash", "Unsplash"]],
  "images.orientation": [
    ["landscape", "Горизонтальная"],
    ["portrait", "Вертикальная"],
    ["squarish", "Квадратная"],
  ],
};
const HIDDEN = new Set([
  "web.port",
  "web.host",
  "web.auto_ssl",
  "web.ssl_email",
  "web.random_port",
  "web.enabled",
]);
const LOCKED = new Set([
  "web.enabled",
  "web.host",
  "web.port",
  "web.domain",
  "web.auto_ssl",
  "web.random_port",
  "web.duckdns.domain",
]);
const secret = (key) =>
  /^(bot_token|api[_-]?key|access_key|password|token|secret|authorization)$/i.test(
    key,
  );
function node(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
  $("message").hidden = false;
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      ? "auto"
      : "smooth",
  });
}
async function api(url, data) {
  const r = await fetch(url, {
    method: data ? "POST" : "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await r.json();
  if (r.status === 401) {
    $("app").hidden = true;
    $("login").hidden = false;
  }
  if (!r.ok)
    throw new Error([result.error, ...(result.errors || [])].join("\n"));
  return result;
}
function markDirty(value = true) {
  dirty = value;
  if (value) editGeneration++;
  $("saveStatus").textContent = value
    ? "Сохраняем черновик…"
    : "Все изменения сохранены";
  document.querySelector(".savebar").classList.toggle("dirty", value);
  if (value) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => save(), 1200);
  }
}
function setValue(parts, value) {
  markDirty();
  let at = config;
  for (const part of parts.slice(0, -1)) at = at[part];
  at[parts.at(-1)] = value;
}
function renderField(key, value, parts, parent) {
  const full = parts.join(".");
  if (HIDDEN.has(full)) return;
  let meta = META[key] || [
    key.replace(/_/g, " "),
    "Дополнительная настройка. Значение сохраняется в конфигурации сервера.",
  ];
  if (key === "type" && parts[0] === "news_sources")
    meta = [
      "Формат источника",
      "RSS — обычная новостная лента. JSON API — ответ сервера, для которого ниже задаются пути к списку новостей и его полям.",
    ];
  if (
    full === "web.duckdns" &&
    !value.enabled &&
    !String(config.web?.domain || "").endsWith(".duckdns.org")
  ) {
    const details = node("details", { class: "optional-settings" });
    details.append(
      node("summary", {}, "DuckDNS не используется"),
      node(
        "p",
        { class: "help" },
        "Домен уже подключён другим способом. При необходимости настройки DuckDNS можно посмотреть здесь.",
      ),
    );
    const content = node("div", { class: "optional-content" });
    Object.entries(value).forEach(([k, v]) =>
      renderField(k, v, [...parts, k], content),
    );
    details.append(content);
    parent.append(details);
    return;
  }
  if (
    Array.isArray(value) &&
    ((value[0] && typeof value[0] === "object") ||
      ["telegram.targets", "news_sources.custom"].includes(full))
  ) {
    const wrap = node("div", {
      class: `group ${full === "updates" ? "compact-group" : ""}`,
    });
    wrap.append(node("h2", {}, meta[0]), node("p", { class: "help" }, meta[1]));
    if (!value.length)
      wrap.append(node("p", { class: "empty" }, "Пока ничего не добавлено."));
    value.forEach((item, i) => {
      const box = node("div", { class: "array-item" });
      const heading = node("div", { class: "item-heading" });
      heading.append(
        node("h2", {}, item.name || `Получатель / источник ${i + 1}`),
      );
      const remove = node(
        "button",
        { type: "button", class: "secondary remove" },
        "Удалить из списка",
      );
      remove.onclick = () => {
        value.splice(i, 1);
        markDirty();
        show(current);
      };
      heading.append(remove);
      box.append(heading);
      Object.entries(item).forEach(([k, v]) =>
        renderField(k, v, [...parts, i, k], box),
      );
      wrap.append(box);
    });
    const add = node(
      "button",
      { type: "button", class: "secondary" },
      full === "telegram.targets" ? "Добавить получателя" : "Добавить источник",
    );
    add.onclick = () => {
      value.push(
        full === "telegram.targets"
          ? { name: "Мой канал", type: "channel", chat_id: "", enabled: true }
          : {
              name: "Мой источник",
              enabled: false,
              type: "rss",
              url: "https://example.com/rss",
              method: "GET",
              headers: {},
              params: {},
              items_path: "items",
              fields: {
                title: "title",
                description: "description",
                url: "url",
                published_at: "publishedAt",
                source: "source",
              },
            },
      );
      markDirty();
      show(current);
    };
    wrap.append(add);
    parent.append(wrap);
    return;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrap = node("div", {
      class: `group ${full === "updates" ? "compact-group" : ""}`,
    });
    wrap.append(node("h2", {}, meta[0]), node("p", { class: "help" }, meta[1]));
    if (["headers", "params"].includes(key)) {
      jsonInput(value, parts, wrap);
    } else
      Object.entries(value)
        .filter(
          ([k]) =>
            !(
              [
                "news_sources.newsapi",
                "news_sources.gnews",
                "news_sources.mediastack",
              ].includes(full) &&
              value.enabled === false &&
              k !== "enabled"
            ) && !(full === "digest" && k === "show_source"),
        )
        .forEach(([k, v]) => renderField(k, v, [...parts, k], wrap));
    parent.append(wrap);
    return;
  }
  const field = node("div", { class: "field" }),
    id = "field-" + ++sequence,
    copy = node("div", { class: "field-copy" }),
    control = node("div", { class: "field-control" });
  copy.append(node("label", { for: id }, meta[0]));
  let input;
  let choices = ENUMS[full];
  if (key === "type" && parts[0] === "telegram")
    choices = [
      ["channel", "Канал"],
      ["supergroup", "Супергруппа"],
      ["private", "Личные сообщения"],
      ["group", "Обычная группа"],
    ];
  if (key === "type" && parts[0] === "news_sources")
    choices = [
      ["rss", "RSS-лента"],
      ["json", "JSON API"],
    ];
  if (choices) {
    if (
      full === "schedule.timezone" &&
      !choices.some(([option]) => option === value)
    ) {
      choices = [
        [value, window.PanelFields.labelForTimezone(value)],
        ...choices,
      ];
    }
    input = node("select", { id });
    for (const [v, label] of choices)
      input.append(node("option", { value: v }, label));
    input.value =
      { google_ai: "google", gemini: "google", chatgpt: "openai" }[value] ||
      value;
    input.onchange = () => {
      setValue(parts, input.value);
      if (full === "ai.provider") {
        const provider = input.value === "google" ? "google_ai" : input.value;
        config[provider].enabled = true;
        show(current);
      }
    };
  } else if (typeof value === "boolean") {
    input = node("input", { id, type: "checkbox", role: "switch" });
    input.checked = value;
    input.setAttribute("aria-checked", String(value));
    input.onchange = () => {
      setValue(parts, input.checked);
      input.setAttribute("aria-checked", String(input.checked));
      if (key === "enabled" && parts[0] === "news_sources") show(current);
    };
  } else if (
    Array.isArray(value) &&
    full === "news_sources.newsapi.categories"
  ) {
    input = node("div", { id, class: "check-grid" });
    for (const [category, label] of window.PanelFields.newsApiCategories) {
      const option = node("label", { class: "check-option" }),
        box = node("input", { type: "checkbox", value: category });
      box.checked = value.includes(category);
      box.onchange = () =>
        setValue(
          parts,
          [...input.querySelectorAll("input:checked")].map(
            (item) => item.value,
          ),
        );
      option.append(box, node("span", {}, label));
      input.append(option);
    }
  } else if (Array.isArray(value)) {
    input = node("textarea", { id });
    input.value = value.join("\n");
    input.oninput = () =>
      setValue(
        parts,
        input.value
          .split(/[,\n]+/)
          .map((v) => v.trim())
          .filter(Boolean),
      );
  } else {
    const hidden = secret(key),
      numeric =
        typeof value === "number" ||
        key.endsWith("usd_per_million") ||
        key === "temperature";
    input = node("input", {
      id,
      type: hidden ? "password" : numeric ? "number" : "text",
      autocomplete: hidden ? "new-password" : "off",
    });
    if (numeric) input.step = "any";
    input.value = value ?? "";
    input.oninput = () =>
      setValue(
        parts,
        numeric
          ? input.value === ""
            ? null
            : Number(input.value)
          : input.value,
      );
    if (hidden && secrets.has(full))
      input.placeholder = "Ключ сохранён — оставь пустым";
  }
  if (LOCKED.has(full)) {
    input.disabled = true;
    input.classList.add("readonly");
  }
  const help = node(
    "p",
    { class: "help", id: id + "-help" },
    meta[1] +
      (secret(key) && secrets.has(full)
        ? " Ключ сохранён. Пустое поле оставляет его, «-» удаляет."
        : ""),
  );
  input.setAttribute?.("aria-describedby", id + "-help");
  copy.append(help);
  if (full === "telegram.footer_text")
    control.append(
      window.PanelEditor.createHtmlEditor(value, (newValue) =>
        setValue(parts, newValue),
      ),
    );
  else if (typeof value === "boolean") {
    const toggle = node("label", { class: "toggle", for: id });
    toggle.append(input, node("span", {}, value ? "Включено" : "Выключено"));
    const handler = input.onchange;
    input.onchange = () => {
      toggle.lastChild.textContent = input.checked ? "Включено" : "Выключено";
      handler();
    };
    control.append(toggle);
  } else control.append(input);
  if (full === "telegram.bot_token") {
    const state = node(
      "span",
      { class: "validation-state" },
      "Введите токен для проверки",
    );
    control.append(state);
    input.oninput = () => {
      setValue(parts, input.value);
      input.classList.remove("valid", "invalid");
      state.textContent = "Проверяем…";
      clearTimeout(testTimer);
      testTimer = setTimeout(() => testTelegram(input, state), 700);
    };
  }
  field.append(copy, control);
  parent.append(field);
}
function jsonInput(value, parts, parent) {
  const area = node("textarea");
  area.value = JSON.stringify(value, null, 2);
  area.setAttribute("aria-label", "JSON параметров источника");
  area.oninput = () => {
    try {
      const parsed = JSON.parse(area.value);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error();
      setValue(parts, parsed);
      area.setCustomValidity("");
      invalidJSON.delete(parts.join("."));
    } catch {
      invalidJSON.add(parts.join("."));
      area.setCustomValidity("Нужен корректный JSON-объект");
    }
  };
  parent.append(area);
}
function show(name) {
  current = name;
  $("mobileNavigation").value = name;
  $("pageName").textContent = SECTIONS.find((s) => s[0] === name)[1];
  for (const b of $("navigation").children) {
    b.classList.toggle("active", b.dataset.section === name);
    if (b.dataset.section === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  $("overview").hidden = name !== "overview";
  $("editor").hidden = name === "overview";
  if (name === "overview") return;
  const section = SECTIONS.find((s) => s[0] === name);
  $("sectionTitle").textContent = section[1];
  $("sectionDescription").textContent = section[2];
  $("fields").replaceChildren();
  const keys =
    name === "ai"
      ? [
          "ai",
          { google: "google_ai", gemini: "google_ai", chatgpt: "openai" }[
            config.ai.provider
          ] || config.ai.provider,
        ]
      : section[3];
  for (const key of keys)
    if (config[key] !== undefined)
      renderField(key, config[key], [key], $("fields"));
  if (name === "telegram" && config.digest?.show_source !== undefined) {
    const sourceGroup = node("div", { class: "group source-setting" });
    sourceGroup.append(
      node("h2", {}, "Ссылка на оригинал"),
      node(
        "p",
        { class: "help" },
        "Настройка строки с источником под каждой публикацией.",
      ),
    );
    renderField(
      "show_source",
      config.digest.show_source,
      ["digest", "show_source"],
      sourceGroup,
    );
    $("fields").append(sourceGroup);
  }
  if (name === "ai") {
    const test = node(
      "button",
      { type: "button", class: "secondary test-connection" },
      "Проверить модель",
    );
    test.onclick = () => testLlm(test);
    $("fields").append(test);
  }
}
async function loadConfig() {
  invalidJSON.clear();
  const data = await api("/api/config");
  config = data.config;
  secrets = new Set(data.secrets);
  csrf = data.csrf;
  revision = data.revision;
  markDirty(false);
  config.monitoring ??= {};
  for (const name of ["openai", "google_ai", "custom"])
    config.monitoring[name] ??= {
      input_usd_per_million: null,
      output_usd_per_million: null,
    };
  $("login").hidden = true;
  $("app").hidden = false;
  show(data.status.setup ? "telegram" : current);
  await refresh();
}
async function refresh() {
  try {
    const s = await api("/api/state");
    $("version").textContent = "v" + s.version;
    $("connectionStatus").textContent = s.busy
      ? "Готовится выпуск"
      : s.ready
        ? "Бот работает"
        : "Публикации выключены";
    $("stateBadge").classList.toggle("ready", s.ready);
    $("stateTitle").textContent = s.setup
      ? "Заверши настройку бота"
      : s.ready
        ? "Бот включён"
        : "Бот остановлен";
    $("stateDescription").textContent =
      s.error ||
      (s.ready
        ? "Автопубликация включена. Можно изменить настройки или отправить выпуск вручную."
        : "Заполни настройки в разделах слева и нажми «Сохранить и включить бота». Публикации будут отправляться активным получателям по расписанию.");
    $("targetCount").textContent = s.targets;
    $("updateState").textContent = s.updates.error
      ? "Ошибка проверки"
      : s.updates.updateAvailable
        ? "Доступно обновление"
        : s.updates.checkedAt
          ? "Актуально"
          : "Ещё не проверено";
    $("report").textContent = s.report;
    $("runNow").disabled = !s.ready || s.busy;
    renderRoute();
  } catch (e) {
    if (!$("app").hidden) message(e.message, true);
  }
}
async function save(activate) {
  if (saveInFlight) {
    pendingSave = typeof activate === "boolean" ? activate : "auto";
    return;
  }
  if (invalidJSON.size) {
    if (typeof activate === "boolean")
      message("Исправь JSON параметров источника перед сохранением.", true);
    return;
  }
  for (const input of $("fields").querySelectorAll("textarea"))
    if (!input.reportValidity()) return;
  saveInFlight = true;
  const generation = editGeneration;
  const buttons = [$("activate"), $("saveDraft")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const payload = { config, revision };
    if (typeof activate === "boolean") payload.activate = activate;
    const result = await api("/api/config", payload);
    revision = result.revision || revision;
    if (generation === editGeneration) markDirty(false);
    if (typeof activate === "boolean") {
      message(result.message);
      await loadConfig();
    }
  } catch (e) {
    $("saveStatus").textContent = "Не удалось сохранить";
    if (typeof activate === "boolean") message(e.message, true);
  } finally {
    saveInFlight = false;
    buttons.forEach((b) => (b.disabled = false));
    if (pendingSave !== null) {
      const next = pendingSave;
      pendingSave = null;
      setTimeout(() => save(next === "auto" ? undefined : next), 0);
    }
  }
}
async function testTelegram(input, state) {
  try {
    const result = await api("/api/test/telegram", { config });
    input.classList.add("valid");
    input.classList.remove("invalid");
    state.textContent = result.username
      ? `Токен действителен: @${result.username}`
      : "Токен действителен";
  } catch (error) {
    input.classList.add("invalid");
    input.classList.remove("valid");
    state.textContent = error.message;
  }
}
async function testLlm(button) {
  button.disabled = true;
  button.textContent = "Проверяем модель…";
  try {
    const result = await api("/api/test/llm", { config });
    message(`Подключение работает: ${result.provider} / ${result.model}`);
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Проверить модель";
  }
}
$("loginForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/login", { password: $("password").value });
    csrf = result.csrf;
    $("password").value = "";
    await loadConfig();
  } catch (e) {
    $("loginError").textContent = e.message;
  }
};
$("logout").onclick = async () => {
  try {
    await api("/api/logout", {});
  } finally {
    location.reload();
  }
};
$("activate").onclick = () => save(true);
$("saveDraft").onclick = () => save();
$("refresh").onclick = refresh;
$("runNow").onclick = async () => {
  if (
    !confirm(
      "Опубликовать новые новости первому активному получателю прямо сейчас?",
    )
  )
    return;
  $("runNow").disabled = true;
  try {
    const result = await api("/api/run", {});
    message("Отправлено сообщений: " + result.sent);
  } catch (e) {
    message(e.message, true);
  } finally {
    await refresh();
  }
};
$("openPrices").onclick = () => show("monitoring");
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function renderRoute() {
  const feeds = config.news_sources || {},
    rss = feeds.rss_feeds?.length || 0,
    custom = (feeds.custom || []).filter((x) => x.enabled !== false).length,
    apis = ["newsapi", "gnews", "mediastack"].filter(
      (k) => feeds[k]?.enabled,
    ).length,
    provider =
      { google: "google_ai", gemini: "google_ai", chatgpt: "openai" }[
        config.ai?.provider
      ] || config.ai?.provider,
    model = config[provider]?.model;
  const steps = [
    ["news", "Источники", `${rss} RSS · ${custom + apis} API / источников`],
    ["ai", "Обработка ИИ", model || "Выбери модель"],
    [
      "telegram",
      "Доставка",
      `${(config.telegram?.targets || []).filter((t) => t.enabled !== false).length} активных получателей`,
    ],
  ];
  $("connectionSteps").replaceChildren();
  steps.forEach(([id, label, value], i) => {
    const b = node("button", { type: "button", class: "route-step" });
    b.append(
      node("span", {}, "0" + (i + 1)),
      node("strong", {}, label),
      node("span", { class: "route-value" }, value),
    );
    b.onclick = () => show(id);
    $("connectionSteps").append(b);
  });
}
for (const [i, [id, label]] of SECTIONS.entries()) {
  const button = node("button", { type: "button" });
  button.append(
    node(
      "span",
      { class: "nav-index", "aria-hidden": "true" },
      String(i + 1).padStart(2, "0"),
    ),
    node("span", {}, id === "ai" ? "Модели и API" : label),
  );
  button.dataset.section = id;
  button.onclick = () => show(id);
  $("navigation").append(button);
  const option = node(
    "option",
    { value: id },
    id === "ai" ? "Модели и API" : label,
  );
  $("mobileNavigation").append(option);
}
$("mobileNavigation").onchange = () => show($("mobileNavigation").value);
loadConfig().catch(() => {});
setInterval(() => {
  if (!$("app").hidden) refresh();
}, 15000);
