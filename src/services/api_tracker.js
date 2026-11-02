const { PRICES } = require('./llm_config');
class ApiTracker {
  constructor(db, config) { this.db = db; this.cfg = config.monitoring || {}; }
  estimateUsd(tokens) { return (Number(tokens||0) / 1_000_000) * Number(this.cfg.clodex?.usd_per_million_tokens ?? 0.1); }
  estimateRub(usd) { return Number(usd||0) * Number(this.cfg.currency?.usd_rub ?? 90); }
  trackHttp(service, operation) { this.db.trackUsage(service, operation, {}, 0, 0); }
  trackLlm(service, model, operation, usage = {}) {
    const prompt = Number(usage.prompt_tokens || 0), completion = Number(usage.completion_tokens || 0);
    const total = Number(usage.total_tokens || prompt + completion);
    const custom = this.cfg[service] || {};
    const rates = PRICES[service]?.[model];
    const input = custom.input_usd_per_million ?? rates?.[0];
    const output = custom.output_usd_per_million ?? rates?.[1];
    const usd = input != null && output != null
      ? (prompt * Number(input) + completion * Number(output)) / 1_000_000
      : service === 'clodex' ? this.estimateUsd(total) : 0;
    this.db.trackUsage(service, operation, { ...usage, total_tokens: total }, usd, this.estimateRub(usd));
    return { totalTokens: total, usd, rub: this.estimateRub(usd) };
  }
  trackClodex(operation, usage = {}) { return this.trackLlm('clodex', '', operation, usage); }
  summary() { return this.db.usageSummary(); }
  month() { return this.db.recentUsage(30); }
}
module.exports = ApiTracker;

