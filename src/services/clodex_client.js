const axios = require('axios');

// Keep the module name for compatibility with existing imports.
class ClodexClient {
  constructor(config, tracker) { this.cfg = config; this.tracker = tracker; }
  async chat(messages) {
    const cfg = this.cfg;
    const provider = cfg?.provider || 'clodex';
    if (!cfg?.enabled) throw new Error(`${provider}: генерация отключена`);
    if (!cfg.api_key || String(cfg.api_key).startsWith('YOUR_')) throw new Error(`${provider}: не задан API-ключ`);
    if (!cfg.model || String(cfg.model).startsWith('YOUR_')) throw new Error(`${provider}: не задана модель`);
    let url, body, headers = { 'Content-Type': 'application/json' };
    if (provider === 'google_ai') {
      const model = String(cfg.model).replace(/^models\//, '');
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers['x-goog-api-key'] = cfg.api_key;
      body = {
        systemInstruction: { parts: messages.filter(m => m.role === 'system').map(m => ({ text: m.content })) },
        contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: cfg.temperature ?? 0.2, maxOutputTokens: cfg.max_output_tokens || 8192, responseMimeType: 'application/json' }
      };
    } else {
      const base = provider === 'openai' ? 'https://api.openai.com/v1' : cfg.base_url || 'https://clodex.xyz/v1';
      url = `${String(base).replace(/\/$/, '')}/chat/completions`;
      headers.Authorization = `Bearer ${cfg.api_key}`;
      body = { model: cfg.model, messages };
      if (provider === 'openai') {
        body.max_completion_tokens = cfg.max_output_tokens || 8192;
        // Temperature is not supported by every reasoning model.
      } else {
        body.max_tokens = cfg.max_output_tokens || 1400;
        body.temperature = cfg.temperature ?? 0.2;
      }
    }
    let data;
    try {
      data = (await axios.post(url, body, { timeout: cfg.timeout_ms || 90000, headers })).data;
    } catch (error) {
      // Axios errors may contain request headers with API keys. Never propagate them.
      throw new Error(`${provider}: ${error.response?.status ? `HTTP ${error.response.status}` : 'сеть или таймаут'}. Проверь ключ, модель, баланс и квоту.`);
    }
    let text, usage;
    if (provider === 'google_ai') {
      const u = data.usageMetadata || {};
      usage = { prompt_tokens: u.promptTokenCount || 0, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), total_tokens: u.totalTokenCount || 0 };
      this.track(provider, usage);
      if (data.candidates?.[0]?.finishReason !== 'STOP') throw new Error('google_ai: ответ заблокирован или не завершён; увеличь max_output_tokens');
      text = data.candidates[0].content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    } else {
      usage = data.usage || {};
      this.track(provider, usage);
      const choice = data.choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error(`${provider}: ответ не завершён; увеличь max_output_tokens`);
      text = choice?.message?.content;
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error(`${provider}: пустой ответ`);
    return text;
  }
  track(provider, usage) {
    if (!this.tracker) return;
    if (this.tracker.trackLlm) this.tracker.trackLlm(provider, this.cfg.model, 'generate', usage);
    else if (provider === 'clodex') this.tracker.trackClodex('chat.completions', usage);
  }
}
module.exports = ClodexClient;
