const PRICES = {
  openai: { 'gpt-6-luna': [0.10, 0.50], 'gpt-5.6-luna': [0.20, 1.20], 'gpt-5-nano': [0.05, 0.40] },
  google_ai: { 'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-3.1-flash-lite': [0.25, 1.50], 'gemini-3.5-flash-lite': [0.30, 2.50] }
};
function completionUrl(base) {
  let url;
  try { url = new URL(String(base || '').trim()); } catch { throw new Error('custom.base_url: нужен HTTP(S) URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('custom.base_url: нужен HTTP(S) URL без пароля, query и fragment');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.toString();
}
function resolveLlm(config) {
  const requested = config.ai?.provider;
  const aliases = { google: 'google_ai', gemini: 'google_ai', chatgpt: 'openai' };
  const provider = aliases[requested] || requested ||
    (config.google_ai && config.google_ai.enabled !== false && config.google_ai.api_key && !String(config.google_ai.api_key).startsWith('YOUR_') ? 'google_ai' : 'clodex');
  if (!['openai', 'google_ai', 'clodex', 'custom'].includes(provider)) throw new Error('ai.provider: openai, google, clodex или custom');
  const cfg = config[provider] || {};
  if (provider === 'custom') {
    completionUrl(cfg.base_url);
    if (cfg.token_parameter && !['max_tokens', 'max_completion_tokens'].includes(cfg.token_parameter)) throw new Error('custom.token_parameter: max_tokens или max_completion_tokens');
  }
  return { ...cfg, provider, enabled: cfg.enabled !== false, model: cfg.model || (provider === 'openai' ? 'gpt-6-luna' : provider === 'google_ai' ? 'gemini-2.5-flash-lite' : '') };
}
module.exports = { resolveLlm, PRICES, completionUrl };
