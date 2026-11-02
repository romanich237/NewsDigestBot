const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..");
const { AutoUpdater, recoverUpdate } = require("./services/auto_updater");
recoverUpdate(ROOT);
const cron = require("node-cron");
const { jaccard } = require("./utils");
const AppDatabase = require("./database/db");
const ApiTracker = require("./services/api_tracker");
const NewsFetcher = require("./services/news_fetcher");
const LlmClient = require("./services/clodex_client");
const DigestGenerator = require("./services/digest_generator");
const TelegramSender = require("./bot/telegram_sender");
const buildApiReport = require("./bot/api_report");
const { resolveLlm } = require("./services/llm_config");
const {
  prepareConfig,
  validate,
  saveConfig,
} = require("./services/configuration");
const { startDuckDns } = require("./services/duckdns");
const { hashPassword } = require("./web/security");
const configFile = path.join(ROOT, "config.json");
const example = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"),
);
const config = prepareConfig(
  example,
  fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, "utf8"))
    : {},
);
if (
  config.web?.password &&
  !/^(?:CHANGE_ME|scrypt\$)/.test(config.web.password)
) {
  config.web.password = hashPassword(config.web.password);
  saveConfig(configFile, config);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--validate") || args.has("--validate-install")) {
    const errors = validate(
      config,
      args.has("--validate") ||
        config.setup?.completed !== false ||
        !config.web.enabled,
    );
    if (errors.length) console.error(errors.join("\n"));
    else console.log("Конфигурация бота корректна");
    process.exitCode = errors.length ? 1 : 0;
    return;
  }
  const db = new AppDatabase(path.join(ROOT, "data.db"));
  let tracker, fetcher, generator, telegram, timer, cronTask, updater, stopDns;
  let activeRuns = 0,
    paused = false,
    applying = false,
    lastError = "",
    ready = false,
    shutting = false;
  function clearSchedule() {
    clearTimeout(timer);
    if (cronTask) {
      cronTask.stop();
      cronTask.destroy();
      cronTask = null;
    }
  }
  async function stopBot() {
    clearSchedule();
    ready = false;
    if (telegram) {
      try {
        await telegram.stop();
      } catch {}
      telegram = null;
    }
  }
  function targetIds() {
    return config.telegram.targets
      .filter((t) => t.enabled !== false)
      .map((t) => String(t.chat_id));
  }
  function report() {
    return tracker
      ? buildApiReport(config, tracker)
      : "Статистика станет доступна после настройки бота.";
  }
  function status() {
    return {
      ready,
      busy: activeRuns > 0,
      setup: !config.setup?.completed,
      error: lastError,
      version: require("../package.json").version,
    };
  }
  async function runAndSend(chatId) {
    if (!ready)
      throw new Error("Сначала заверши настройку и включи бота в панели.");
    if (paused || applying)
      throw new Error(
        "Идёт обновление или применение настроек. Попробуй позже.",
      );
    if (activeRuns)
      throw new Error("Выпуск уже готовится. Дождись завершения.");
    activeRuns++;
    try {
      db.prunePublished(config.digest.memory_days || 30);
      const all = await fetcher.fetchAll();
      const fresh = all.filter(
        (item) =>
          !db.hasPublished(
            item,
            config.digest.dedup_similarity || 0.86,
            jaccard,
          ),
      );
      const items = await generator.generate(fresh);
      if (!items.length) throw new Error("Новых подходящих новостей нет.");
      await telegram.sendDigest(items, chatId);
      db.addPublished(
        items.map((item) => ({
          title: item.item.title,
          url: item.item.url,
          published_at: new Date().toISOString(),
        })),
      );
      return config.digest.mode === "single" ? items.length : 1;
    } finally {
      activeRuns--;
    }
  }
  async function runScheduled() {
    for (const id of targetIds()) {
      try {
        await runAndSend(id);
      } catch (error) {
        console.error("[SEND]", error.message);
      }
    }
  }
  function scheduleNext() {
    if (!ready || shutting) return;
    const min = Number(config.schedule.interval_min_minutes),
      max = Number(config.schedule.interval_max_minutes);
    if (min > 0)
      timer = setTimeout(
        async () => {
          await runScheduled();
          scheduleNext();
        },
        Math.round((min + Math.random() * (max - min)) * 60000),
      );
    else
      cronTask = cron.schedule(config.schedule.cron, runScheduled, {
        timezone: config.schedule.timezone,
      });
  }
  async function startBot() {
    await stopBot();
    const errors = validate(config, true);
    if (config.setup?.completed === false || errors.length) {
      lastError = errors.join("; ");
      return;
    }
    try {
      tracker = new ApiTracker(db, config);
      fetcher = new NewsFetcher(config, tracker);
      generator = new DigestGenerator(
        config,
        new LlmClient(resolveLlm(config), tracker),
      );
      telegram = new TelegramSender(config, report);
      telegram.setConfigSaver(() => saveConfig(configFile, config));
      telegram.setPreviewHandler((chatId) => runAndSend(chatId));
      ready = true;
      lastError = "";
      const activeBot = telegram;
      telegram.launch().catch((error) => {
        if (telegram === activeBot) {
          lastError = error.message;
          ready = false;
          clearSchedule();
          console.error("[TELEGRAM]", error.message);
        }
      });
      scheduleNext();
    } catch (error) {
      lastError = error.message;
      ready = false;
    }
  }
  async function applyConfig(next) {
    if (
      activeRuns ||
      paused ||
      applying ||
      fs.existsSync(path.join(ROOT, ".updates/control.json"))
    )
      throw new Error("Дождись завершения публикации или обновления.");
    applying = true;
    try {
      // Save before replacing live objects; a failed write leaves the current bot untouched.
      saveConfig(configFile, next);
      await stopBot();
      if (stopDns) stopDns();
      updater?.stop();
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, next);
      stopDns = startDuckDns(config);
      await startBot();
      updater = new AutoUpdater(ROOT, config, {
        pause: (value) => {
          paused = value;
        },
        busy: () => activeRuns > 0 || applying,
        restart: () => process.kill(process.pid, "SIGTERM"),
      });
      updater.start();
      return status();
    } finally {
      applying = false;
    }
  }
  let web;
  if (
    config.web?.enabled &&
    !/^CHANGE_ME/.test(config.web.password || "") &&
    config.web.password
  ) {
    const { createWebServer } = require("./web/server");
    web = createWebServer({
      config,
      root: ROOT,
      apply: applyConfig,
      status,
      report,
      runNow: async () => {
        const id = targetIds()[0];
        if (!id) throw new Error("Добавь активного получателя");
        return runAndSend(id);
      },
    });
    await new Promise((resolve, reject) => {
      web.once("error", reject);
      web.listen(
        Number(config.web.port),
        config.web.host || "127.0.0.1",
        resolve,
      );
    });
    console.log(
      `[WEB] Панель готова: ${config.web.domain ? "https://" + config.web.domain : "http://localhost:" + config.web.port}`,
    );
  }
  await startBot();
  if (!ready && !web) {
    console.error("Бот не настроен. Запусти установщик или npm run configure.");
    db.close();
    process.exitCode = 1;
    return;
  }
  stopDns = startDuckDns(config);
  updater = new AutoUpdater(ROOT, config, {
    pause: (value) => {
      paused = value;
    },
    busy: () => activeRuns > 0 || applying,
    restart: () => process.kill(process.pid, "SIGTERM"),
  });
  updater.start();
  async function shutdown() {
    if (shutting) return;
    shutting = true;
    updater?.stop();
    stopDns?.();
    await stopBot();
    web?.close();
    db.close();
    process.exit(0);
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (args.has("--preview") || args.has("--now")) {
    try {
      console.log("Отправлено сообщений:", await runAndSend(targetIds()[0]));
    } finally {
      await shutdown();
    }
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
