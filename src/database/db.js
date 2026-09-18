const Database = require('better-sqlite3');
const path = require('path');

class AppDatabase {
  constructor(file = path.join(__dirname, '../../data.db')) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS published_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT,
        published_at TEXT NOT NULL,
        inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_published_news_date ON published_news(published_at);
      CREATE INDEX IF NOT EXISTS idx_published_news_url ON published_news(url);

      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,
        operation TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 1,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_usd REAL NOT NULL DEFAULT 0,
        estimated_rub REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_api_usage_service_date ON api_usage(service, created_at);

      CREATE TABLE IF NOT EXISTS bot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        chat_id TEXT,
        user_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_bot_events_date ON bot_events(created_at);
    `);
  }

  prunePublished(days = 30) {
    this.db.prepare("DELETE FROM published_news WHERE datetime(published_at) < datetime('now', ?)").run(`-${days} days`);
  }

  hasPublished(item, threshold, similarityFn) {
    if (item.url) {
      const row = this.db.prepare('SELECT 1 FROM published_news WHERE url = ? LIMIT 1').get(item.url);
      if (row) return true;
    }
    const rows = this.db.prepare('SELECT title FROM published_news WHERE datetime(published_at) >= datetime(\'now\', \'-30 days\')').all();
    return rows.some(row => similarityFn(item.title, row.title) >= threshold);
  }

  addPublished(items) {
    const stmt = this.db.prepare('INSERT INTO published_news(title, url, published_at) VALUES (?, ?, ?)');
    const tx = this.db.transaction((rows) => {
      for (const x of rows) stmt.run(x.title, x.url || null, x.published_at || new Date().toISOString());
    });
    tx(items);
  }

  trackUsage(service, operation, usage = {}, usd = 0, rub = 0) {
    this.db.prepare(`INSERT INTO api_usage(service, operation, requests, prompt_tokens, completion_tokens, total_tokens, estimated_usd, estimated_rub)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)`)
      .run(service, operation, usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0, usd || 0, rub || 0);
  }

  usageSummary() {
    return this.db.prepare(`SELECT service,
      SUM(requests) requests, SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens,
      SUM(total_tokens) total_tokens, SUM(estimated_usd) estimated_usd, SUM(estimated_rub) estimated_rub
      FROM api_usage GROUP BY service ORDER BY service`).all();
  }

  recentUsage(days = 30) {
    return this.db.prepare(`SELECT service,
      SUM(requests) requests, SUM(total_tokens) total_tokens, SUM(estimated_usd) estimated_usd, SUM(estimated_rub) estimated_rub
      FROM api_usage WHERE datetime(created_at) >= datetime('now', ?)
      GROUP BY service ORDER BY service`).all(`-${days} days`);
  }

  logEvent(eventType, chatId, userId, details = '') {
    this.db.prepare('INSERT INTO bot_events(event_type, chat_id, user_id, details) VALUES (?, ?, ?, ?)')
      .run(eventType, chatId != null ? String(chatId) : null, userId != null ? String(userId) : null, details);
  }

  close() { this.db.close(); }
}

module.exports = AppDatabase;
