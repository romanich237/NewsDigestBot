const {
  bodyFor,
  sendFormatted,
  sanitizeTelegramHtml,
} = require("../services/post_format");
const { Telegraf, Markup } = require("telegraf");
const { escapeHtml, validHttpUrl } = require("../utils");
const { ImageProvider } = require("../services/image_provider");
class TelegramSender {
  constructor(config, onApi) {
    this.config = config;
    this.cfg = config.telegram;
    this.digestCfg = config.digest || {};
    this.images = new ImageProvider(config);
    this.allowed = new Set(
      (config.telegram.allowed_user_ids || []).map(String),
    );
    this.bot = new Telegraf(this.cfg.bot_token);
    this.onApi = onApi;
    this.awaiting = new Map();
    this.saveConfig = null;
    this.bot.use(async (ctx, next) => {
      if (!this.isAllowed(ctx)) {
        if (ctx.callbackQuery) return ctx.answerCbQuery("Нет доступа.");
        return ctx.reply("Нет доступа.");
      }
      return next();
    });
    this.register();
  }
  setConfigSaver(fn) {
    this.saveConfig = fn;
  }
  persist() {
    try {
      if (this.saveConfig) this.saveConfig(this.config);
    } catch (e) {
      console.error("[CONFIG SAVE]", e.message);
    }
  }
  isAllowed(ctx) {
    return (
      this.allowed.size === 0 || this.allowed.has(String(ctx.from?.id || ""))
    );
  }
  linkifyMentions(t) {
    return escapeHtml(t).replace(
      /@([A-Za-z0-9_]{4,32})/g,
      (m, u) => `<a href="https://t.me/${u}">${m}</a>`,
    );
  }
  footer() {
    return sanitizeTelegramHtml(this.cfg.footer_text || "", 800);
  }
  formatDigest(items) {
    const lines = ["<b>📰 NewsDigestBot — дайджест</b>", ""];
    const inline = this.digestCfg.inline_url === true;
    items.forEach((e, i) => {
      const body = bodyFor(e, this.config);
      if (body) {
        lines.push(body);
        if (this.digestCfg.show_source !== false && validHttpUrl(e.item.url))
          lines.push(
            `<a href="${escapeHtml(e.item.url)}">${escapeHtml(e.item.source || "Источник")}</a>`,
          );
        lines.push("");
        return;
      }
      const emoji = e.type === "international" ? "🌍" : "🇷🇺";
      const t = escapeHtml(e.title || e.item.title);
      const s = escapeHtml(e.summary || e.item.description || "");
      const url = e.item.url;
      const ok = validHttpUrl(url);
      const link = ok && !inline ? `<a href="${escapeHtml(url)}">${t}</a>` : t;
      lines.push(`${i + 1}. ${emoji} ${link}`);
      if (s) lines.push(inline && ok ? `${s} ${escapeHtml(url)}` : s);
      else if (inline && ok) lines.push(escapeHtml(url));
      if (this.digestCfg.show_source !== false && e.item.source)
        lines.push(`<i>Источник: ${escapeHtml(e.item.source)}</i>`);
      lines.push("");
    });
    const footer = this.footer();
    if (footer) lines.push(footer);
    return lines.join("\n");
  }
  formatSingle(item, idx) {
    const emoji = item.type === "international" ? "🌍" : "🇷🇺";
    const t = escapeHtml(item.title || item.item.title);
    const s = escapeHtml(item.summary || item.item.description || "");
    const url = item.item.url;
    const src = item.item.source || "Источник";
    const srcHtml = validHttpUrl(url)
      ? `<a href="${escapeHtml(url)}">${escapeHtml(src)}</a>`
      : escapeHtml(src);
    const body = bodyFor(item, this.config);
    const lines = body ? [body] : [`${idx}. ${emoji} <b>${t}</b>`, ""];
    if (!body && s) lines.push(s);
    if (this.digestCfg.show_source !== false)
      lines.push("", `Источник: ${srcHtml}`);
    const footer = this.footer();
    if (footer) lines.push("", footer);
    return lines.join("\n");
  }
  async sendImage(item, chatId) {
    const image = await this.images.find(item);
    if (!image) return;
    const caption = `Фото: <a href="${escapeHtml(image.authorUrl)}">${escapeHtml(image.author)}</a> / <a href="${escapeHtml(image.providerUrl)}">Unsplash</a>`;
    await this.bot.telegram.sendPhoto(chatId, image.url, {
      caption,
      parse_mode: "HTML",
    });
  }
  async sendSingles(items, chatId) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      if (this.config.images?.enabled && this.config.images?.per_post !== false)
        await this.sendImage(items[i], chatId);
      const html = this.formatSingle(items[i], i + 1);
      await sendFormatted(this.bot.telegram, chatId, html, this.config);
      out.push(html);
    }
    return out.join("\n");
  }
  async sendDigest(items, chatId) {
    if ((this.digestCfg.mode || "digest") === "single")
      return this.sendSingles(items, chatId);
    if (this.config.images?.enabled) await this.sendImage(items[0], chatId);
    const html = this.formatDigest(items);
    await sendFormatted(this.bot.telegram, chatId, html, this.config);
    return html;
  }
  menuKb() {
    return Markup.inlineKeyboard([
      [Markup.button.callback("📰 Дайджест сейчас", "digest_now")],
      [Markup.button.callback("📊 Статистика API", "api_stats")],
      [Markup.button.callback("⚙️ Настройки", "settings")],
    ]);
  }
  settingsText() {
    const d = this.config.digest || {},
      s = this.config.schedule || {};
    const iv = s.interval_min_minutes
      ? `${s.interval_min_minutes}-${s.interval_max_minutes || s.interval_min_minutes} мин (случайно)`
      : `cron: ${s.cron || "—"}`;
    return [
      "<b>⚙️ Настройки сервиса</b>",
      "",
      `⏱ Интервал публикации: <b>${iv}</b>`,
      `🔗 Ссылка в тексте поста: <b>${d.inline_url === true ? "включена" : "выключена"}</b>`,
      `📝 Футер: <b>${this.cfg.footer_text ? escapeHtml(this.cfg.footer_text).split("\n")[0].slice(0, 60) : "не задан"}</b>`,
    ].join("\n");
  }
  settingsKb() {
    const d = this.config.digest || {};
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `🔗 Ссылка в тексте: ${d.inline_url === true ? "ВКЛ" : "ВЫКЛ"}`,
          "toggle_inline",
        ),
      ],
      [Markup.button.callback("⏱ Изменить интервал", "ask_interval")],
      [Markup.button.callback("📝 Изменить футер", "ask_footer")],
      [Markup.button.callback("⬅️ Назад", "panel")],
    ]);
  }
  sendPanel(chatId) {
    return this.bot.telegram.sendMessage(
      chatId,
      "<b>🎛 Панель управления NewsDigestBot</b>\n\nВыберите действие:",
      { parse_mode: "HTML", ...this.menuKb() },
    );
  }
  register() {
    this.bot.start(async (ctx) =>
      ctx.reply(
        "Привет! Я NewsDigestBot.\n\nКоманды:\n/panel — панель управления кнопками\n/preview — собрать и отправить дайджест в этот чат\n/digest — пересобрать дайджест\n/api — статистика API (только разрешённому пользователю).",
        Markup.inlineKeyboard([
          [Markup.button.callback("🎛 Открыть панель", "panel")],
        ]),
      ),
    );
    this.bot.command("panel", async (ctx) => this.sendPanel(ctx.chat.id));
    const run = async (ctx) => {
      try {
        await ctx.reply("Собираю дайджест…");
        await this.onPreview(ctx.chat.id, ctx.chat.type);
      } catch (e) {
        console.error(e);
        await ctx.reply(`Ошибка: ${e.message}`);
      }
    };
    this.bot.command("preview", run);
    this.bot.command("digest", run);
    this.bot.command("api", async (ctx) => {
      if (!this.isAllowed(ctx)) return ctx.reply("Нет доступа.");
      try {
        await ctx.reply(await this.onApi());
      } catch (e) {
        await ctx.reply(`Ошибка API-статистики: ${e.message}`);
      }
    });
    this.bot.action("panel", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx
        .editMessageText(
          "<b>🎛 Панель управления NewsDigestBot</b>\n\nВыберите действие:",
          { parse_mode: "HTML", ...this.menuKb() },
        )
        .catch(() => this.sendPanel(ctx.chat.id));
    });
    this.bot.action("digest_now", async (ctx) => {
      await ctx.answerCbQuery("Собираю дайджест…");
      try {
        await this.onPreview(ctx.chat.id, ctx.chat.type);
      } catch (e) {
        await ctx.reply(`Ошибка: ${e.message}`);
      }
    });
    this.bot.action("api_stats", async (ctx) => {
      await ctx.answerCbQuery();
      try {
        await ctx.reply(await this.onApi(), { parse_mode: "HTML" });
      } catch (e) {
        await ctx.reply(`Ошибка: ${e.message}`);
      }
    });
    this.bot.action("settings", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx
        .editMessageText(this.settingsText(), {
          parse_mode: "HTML",
          ...this.settingsKb(),
        })
        .catch(async () => {
          await this.bot.telegram.sendMessage(
            ctx.chat.id,
            this.settingsText(),
            { parse_mode: "HTML", ...this.settingsKb() },
          );
        });
    });
    this.bot.action("toggle_inline", async (ctx) => {
      if (!this.isAllowed(ctx)) return ctx.answerCbQuery("Нет доступа.");
      this.config.digest = this.config.digest || {};
      this.config.digest.inline_url = this.config.digest.inline_url !== true;
      this.persist();
      await ctx.answerCbQuery(
        `Ссылка в тексте: ${this.config.digest.inline_url ? "ВКЛ" : "ВЫКЛ"}`,
      );
      await ctx
        .editMessageText(this.settingsText(), {
          parse_mode: "HTML",
          ...this.settingsKb(),
        })
        .catch(() => {});
    });
    this.bot.action("ask_interval", async (ctx) => {
      if (!this.isAllowed(ctx)) return ctx.answerCbQuery("Нет доступа.");
      await ctx.answerCbQuery();
      this.awaiting.set(ctx.chat.id, "interval");
      await ctx.reply(
        "Введите интервал публикации в минутах:\n• одно число — фиксированный интервал, например <code>45</code>\n• диапазон — случайный интервал, например <code>30-60</code> или <code>3060</code>",
        { parse_mode: "HTML" },
      );
    });
    this.bot.action("ask_footer", async (ctx) => {
      if (!this.isAllowed(ctx)) return ctx.answerCbQuery("Нет доступа.");
      await ctx.answerCbQuery();
      this.awaiting.set(ctx.chat.id, "footer");
      await ctx.reply(
        "Введите текст футера (можно несколько строк, поддерживаются @username и ссылки).\nОтправьте <code>off</code>, чтобы убрать футер.",
        { parse_mode: "HTML" },
      );
    });
    this.bot.action("back", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx
        .editMessageText(this.settingsText(), {
          parse_mode: "HTML",
          ...this.settingsKb(),
        })
        .catch(() => {});
    });
    this.bot.on("text", async (ctx) => {
      const mode = this.awaiting.get(ctx.chat.id);
      const txt = String(ctx.message?.text || "").trim();
      if (!mode || txt.startsWith("/")) return;
      if (mode === "interval") {
        const m =
          txt.match(/^(\d{1,4})(?:\s*[-–—]\s*|\s+)(\d{1,4})$/) ||
          txt.match(/^(\d{1,4})$/);
        if (!m)
          return ctx.reply(
            "Не понял формат. Примеры: <code>45</code> или <code>30-60</code>. Попробуйте ещё раз.",
            { parse_mode: "HTML" },
          );
        const a = Number(m[1]),
          b = m[2] ? Number(m[2]) : a;
        const mn = Math.min(a, b),
          mx = Math.max(a, b);
        if (mn < 1 || mx > 1440)
          return ctx.reply(
            "Интервал должен быть от1 до1440 минут. Попробуйте ещё раз.",
          );
        this.config.schedule = this.config.schedule || {};
        this.config.schedule.interval_min_minutes = mn;
        this.config.schedule.interval_max_minutes = mx;
        this.persist();
        this.awaiting.delete(ctx.chat.id);
        await ctx.reply(
          `✅ Интервал публикации: каждые <b>${mn}${mx !== mn ? "-" + mx : ""} мин</b>${mx !== mn ? " (случайно)" : ""}.\nИзменение вступит в силу после перезапуска бота.`,
          { parse_mode: "HTML", ...this.settingsKb() },
        );
      } else if (mode === "footer") {
        if (/^off$/i.test(txt)) {
          delete this.cfg.footer_text;
          this.persist();
          this.awaiting.delete(ctx.chat.id);
          await ctx.reply("✅ Футер удалён.", { ...this.settingsKb() });
        } else {
          if (txt.length > 300)
            return ctx.reply(
              "Слишком длинный текст (макс.300 символов). Попробуйте ещё раз.",
            );
          this.cfg.footer_text = txt;
          this.persist();
          this.awaiting.delete(ctx.chat.id);
          await ctx.reply(`✅ Футер обновлён:\n${this.linkifyMentions(txt)}`, {
            parse_mode: "HTML",
            ...this.settingsKb(),
          });
        }
      }
    });
  }
  async launch() {
    return this.bot.launch();
  }
  async stop() {
    this.bot.stop("shutdown");
  }
  setPreviewHandler(fn) {
    this.onPreview = fn;
  }
}
module.exports = TelegramSender;
