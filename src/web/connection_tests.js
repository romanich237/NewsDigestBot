const axios = require("axios");
const LlmClient = require("../services/clodex_client");
const { resolveLlm } = require("../services/llm_config");

async function testTelegram(token) {
  if (!/^\d{5,}:[a-zA-Z0-9_-]{20,}$/.test(token || ""))
    throw new Error("Токен не похож на токен из BotFather");
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${token}/getMe`,
      { timeout: 10000 },
    );
    if (!response.data?.ok) throw new Error();
    return { ok: true, username: response.data.result?.username || "" };
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 404)
      throw new Error("Telegram отклонил токен");
    throw new Error("Не удалось проверить токен: сеть или Telegram недоступны");
  }
}

async function testLlm(config) {
  const selected =
    { google: "google_ai", gemini: "google_ai", chatgpt: "openai" }[
      config.ai?.provider
    ] || config.ai?.provider;
  const llm = { ...resolveLlm(config), max_output_tokens: 128 };
  const client = new LlmClient(llm);
  const result = await client.chat([
    { role: "system", content: "Ответь строго JSON без markdown." },
    {
      role: "user",
      content: 'Верни только {"ok":true} для проверки подключения.',
    },
  ]);
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new Error(`${selected}: сервис ответил, но формат ответа неверный`);
  }
  if (parsed.ok !== true)
    throw new Error(`${selected}: проверочный ответ не подтверждён`);
  return { ok: true, provider: selected, model: llm.model };
}

module.exports = { testLlm, testTelegram };
