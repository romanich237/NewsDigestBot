const PRICES = {
  openai: { 'gpt-6-luna': [0.10, 0.50], 'gpt-5.6-luna': [0.20, 1.20], 'gpt-5-nano': [0.05, 0.40] },
  google_ai: { 'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-3.1-flash-lite': [0.25, 1.50], 'gemini-3.5-flash-lite': [0.30, 2.50] }
};
function resolveLlm(config) {
  const requested = config.ai?.provider;
  const aliases = { google: 'google_ai', gemini: 'google_ai', chatgpt: 'openai' };
  const provider = aliases[requested] || requested ||
    (config.google_ai && config.google_ai.enabled !== false && config.google_ai.api_key && !String(config.google_ai.api_key).startsWith('YOUR_') ? 'google_ai' : 'clodex');
  if (!['openai', 'google_ai', 'clodex'].includes(provider)) throw new Error('ai.provider: openai, google или clodex');
  const cfg = config[provider] || {};
  return { ...cfg, provider, enabled: cfg.enabled !== false, model: cfg.model || (provider === 'openai' ? 'gpt-6-luna' : provider === 'google_ai' ? 'gemini-2.5-flash-lite' : '') };
}
module.exports = { resolveLlm, PRICES };
