class ApiTracker {
  constructor(db, config) { this.db = db; this.cfg = config.monitoring || {}; }
  estimateUsd(tokens) { return (Number(tokens||0) / 1_000_000) * Number(this.cfg.clodex?.usd_per_million_tokens ?? 0.1); }
  estimateRub(usd) { return Number(usd||0) * Number(this.cfg.currency?.usd_rub ?? 90); }
  trackHttp(service, operation) { this.db.trackUsage(service, operation, {}, 0, 0); }
  trackClodex(operation, usage = {}) {
    const total = Number(usage.total_tokens || ((usage.prompt_tokens||0)+(usage.completion_tokens||0)) || 0);
    const usd = this.estimateUsd(total);
    const rub = this.estimateRub(usd);
    this.db.trackUsage('clodex', operation, {...usage, total_tokens: total}, usd, rub);
    return { totalTokens: total, usd, rub };
  }
  summary() { return this.db.usageSummary(); }
  month() { return this.db.recentUsage(30); }
}
module.exports = ApiTracker;
