const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  maskSecrets,
  preserveSecrets,
  merge,
  validate,
} = require("../services/configuration");
const { testLlm, testTelegram } = require("./connection_tests");
const {
  clientIp,
  digest,
  hashPassword,
  sameOrigin,
  securityHeaders,
  verifyPassword,
} = require("./security");

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/panel.js": ["panel.js", "text/javascript; charset=utf-8"],
  "/panel-fields.js": ["panel-fields.js", "text/javascript; charset=utf-8"],
  "/panel-editor.js": ["panel-editor.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/components.css": ["components.css", "text/css; charset=utf-8"],
};

function createWebServer(context) {
  const { config, apply, status, runNow, report } = context;
  const root = context.root || path.resolve(__dirname, "../..");
  const publicDir = path.join(root, "public/panel");
  const sessions = new Map();
  const attempts = new Map();
  const tests = new Map();

  function revision() {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(config))
      .digest("hex");
  }

  function settings() {
    const secrets = [];
    return {
      config: maskSecrets(config, secrets),
      secrets,
      revision: revision(),
      status: status(),
    };
  }

  return http.createServer(async (req, res) => {
    const send = (
      code,
      data,
      type = "application/json; charset=utf-8",
      extra = {},
    ) => {
      res.writeHead(code, {
        ...securityHeaders(req),
        "Content-Type": type,
        ...extra,
      });
      res.end(
        type.startsWith("application/json") ? JSON.stringify(data) : data,
      );
    };

    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && STATIC_FILES[url.pathname]) {
        const [file, type] = STATIC_FILES[url.pathname];
        return send(200, fs.readFileSync(path.join(publicDir, file)), type);
      }
      if (req.method === "POST" && !sameOrigin(req))
        return send(403, { error: "Запрос с другого сайта запрещён" });
      if (url.pathname === "/api/login" && req.method === "POST")
        return login(req, send, config, sessions, attempts);

      const token = cookie(req);
      const session = sessions.get(token);
      if (
        !session ||
        session.until < Date.now() ||
        session.password !== digest(config.web.password).toString("hex")
      ) {
        if (token) sessions.delete(token);
        return send(401, { error: "Войди в панель" });
      }
      if (req.method === "POST" && req.headers["x-csrf-token"] !== session.csrf)
        return send(403, { error: "Обнови страницу и повтори действие" });

      if (url.pathname === "/api/logout" && req.method === "POST") {
        sessions.delete(token);
        return send(200, { ok: true }, undefined, {
          "Set-Cookie":
            "news_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        });
      }
      if (url.pathname === "/api/config" && req.method === "GET")
        return send(200, { ...settings(), csrf: session.csrf });
      if (url.pathname === "/api/config" && req.method === "POST") {
        const data = await body(req);
        if (
          !data.config ||
          typeof data.config !== "object" ||
          Array.isArray(data.config)
        )
          return send(400, { error: "Некорректная конфигурация" });
        if (data.revision !== revision())
          return send(409, {
            error: "Настройки изменены в другой вкладке. Обнови страницу.",
          });
        const next = merge(config, preserveSecrets(config, data.config));
        if (
          next.web.password &&
          !String(next.web.password).startsWith("scrypt$")
        )
          next.web.password = hashPassword(next.web.password);
        next.web = {
          ...next.web,
          enabled: true,
          host: config.web.host,
          port: config.web.port,
          domain: config.web.domain,
          auto_ssl: config.web.auto_ssl,
          random_port: config.web.random_port,
        };
        if (next.web.duckdns && config.web.duckdns)
          next.web.duckdns.domain = config.web.duckdns.domain;
        next.setup = {
          completed:
            typeof data.activate === "boolean"
              ? data.activate
              : config.setup?.completed === true,
        };
        const errors = validate(next, data.activate === true);
        if (errors.length)
          return send(400, { error: "Проверь поля настроек", errors });
        const result = await apply(next);
        const message =
          data.activate === true
            ? "Настройки сохранены и применены."
            : data.activate === false
              ? "Черновик сохранён. Автопубликация выключена."
              : "Черновик сохранён автоматически.";
        return send(200, {
          ok: true,
          status: result,
          message,
          revision: revision(),
        });
      }
      if (url.pathname === "/api/test/telegram" && req.method === "POST") {
        rateLimitTest(tests, token);
        const data = await body(req, 16 * 1024);
        const next = preserveSecrets(config, data.config || {});
        return send(200, await testTelegram(next.telegram?.bot_token));
      }
      if (url.pathname === "/api/test/llm" && req.method === "POST") {
        rateLimitTest(tests, token);
        const data = await body(req);
        const next = merge(config, preserveSecrets(config, data.config || {}));
        return send(200, await testLlm(next));
      }
      if (url.pathname === "/api/run" && req.method === "POST")
        return send(200, { ok: true, sent: await runNow() });
      if (url.pathname === "/api/state" && req.method === "GET") {
        let updates = {};
        try {
          updates = JSON.parse(
            fs.readFileSync(path.join(root, ".updates/status.json"), "utf8"),
          );
        } catch {}
        return send(200, {
          ...status(),
          report: report().replace(/<[^>]+>/g, ""),
          updates,
          targets: config.telegram.targets.filter(
            (target) => target.enabled !== false,
          ).length,
        });
      }
      send(404, { error: "Страница не найдена" });
    } catch (error) {
      send(error.status || 400, { error: error.message || "Ошибка запроса" });
    }
  });
}

async function login(req, send, config, sessions, attempts) {
  const ip = clientIp(req);
  const now = Date.now();
  for (const [key, value] of attempts)
    if (value.until < now) attempts.delete(key);
  const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60000 };
  if (attempt.count >= 8)
    return send(429, {
      error: "Слишком много попыток. Повтори через 15 минут.",
    });
  const data = await body(req, 8 * 1024);
  if (
    !config.web.password ||
    !verifyPassword(data.password, config.web.password)
  ) {
    if (attempts.size < 1000 || attempts.has(ip))
      attempts.set(ip, { ...attempt, count: attempt.count + 1 });
    return send(401, { error: "Неверный пароль" });
  }
  attempts.delete(ip);
  for (const [key, value] of sessions)
    if (value.until < now) sessions.delete(key);
  if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    until: now + 12 * 3600000,
    csrf,
    password: digest(config.web.password).toString("hex"),
  });
  const secure =
    req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
  return send(200, { ok: true, csrf }, undefined, {
    "Set-Cookie": `news_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? "; Secure" : ""}`,
  });
}

function cookie(req) {
  return /(?:^|;\s*)news_session=([a-f0-9]{64})(?:;|$)/.exec(
    req.headers.cookie || "",
  )?.[1];
}

function rateLimitTest(tests, token) {
  const now = Date.now();
  const recent = (tests.get(token) || []).filter((time) => now - time < 60000);
  if (recent.length >= 6) {
    const error = new Error("Слишком много проверок. Подожди минуту.");
    error.status = 429;
    throw error;
  }
  recent.push(now);
  tests.set(token, recent);
}

function body(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > limit) {
        const error = new Error("Слишком большой запрос");
        error.status = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        reject(new Error("Некорректный JSON"));
      }
    });
    req.on("error", reject);
  });
}

module.exports = { createWebServer };
