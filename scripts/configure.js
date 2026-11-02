#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const { updateSettings } = require('../src/services/auto_updater');
const LABELS = {
  telegram: 'Telegram: бот, администраторы и получатели', ai: 'Выбор ИИ и формат постов',
  openai: 'OpenAI', google_ai: 'Google Gemini', clodex: 'CLODEX', news_sources: 'Источники новостей',
  digest: 'Состав и обработка выпуска', schedule: 'Расписание', monitoring: 'Статистика, цены и квоты',
  updates: 'Автообновление GitHub', web: 'Веб-панель'
};
function merge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(extra || {})])].map(k => [k, k in base ? merge(base[k], extra?.[k]) : extra[k]]));
  return extra === undefined ? base : extra;
}
function secret(key) { return /(?:^|[.\[])(?:bot_token|api_key|password|secret|authorization|token)(?:$|[.\]])/i.test(key); }
function placeholder(value) { return typeof value === 'string' && /^(YOUR_|CHANGE_ME|PASTE_)/.test(value); }
function parseValue(raw, current) {
  if (Array.isArray(current)) {
    const values = raw.startsWith('[') ? JSON.parse(raw) : raw.split(',').map(x => x.trim()).filter(Boolean);
    if (!Array.isArray(values) || values.some(x => typeof x === 'object')) throw new Error('Нужен список простых значений');
    return values;
  }
  if (typeof current === 'boolean') {
    if (/^(true|yes|y|да|д|1)$/i.test(raw)) return true;
    if (/^(false|no|n|нет|н|0)$/i.test(raw)) return false;
    throw new Error('Введи да или нет');
  }
  if (typeof current === 'number') {
    const n = Number(raw); if (!Number.isFinite(n)) throw new Error('Нужно число'); return n;
  }
  return raw;
}
async function configure(file = path.resolve(__dirname, '../config.json')) {
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.example.json'), 'utf8'));
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = merge(example, existing);
  let muted = false;
  const output = new Writable({ write(chunk, encoding, next) { if (!muted) process.stdout.write(chunk); next(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  let interrupted = false;
  rl.on('SIGINT', () => { interrupted = true; rl.close(); });
  const ask = (label, hidden = false) => new Promise((resolve, reject) => {
    if (interrupted || rl.closed) return reject(new Error('Настройка прервана; конфигурация не изменена'));
    muted = false;
    const onClose = () => reject(new Error('Ввод завершён; конфигурация не изменена'));
    rl.once('close', onClose);
    rl.question(label, answer => { rl.removeListener('close', onClose); muted = false; if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
    muted = hidden;
  });
  async function field(key, value) {
    if (Array.isArray(value) && (value.some(x => x && typeof x === 'object') || key === 'news_sources.custom')) {
      const items = [];
      for (let i = 0; i < value.length; i++) {
        const keep = await ask(`${key}[${i + 1}]: настроить/оставить? [да, нет = удалить]: `);
        if (/^(нет|no|n)$/i.test(keep)) continue;
        items.push(await field(`${key}[${i + 1}]`, value[i]));
      }
      while (/^(да|yes|y)$/i.test(await ask(`Добавить элемент в ${key}? [нет]: `))) {
        if (key === 'telegram.targets') items.push(await field(`${key}[${items.length + 1}]`, { name: '', type: 'channel', chat_id: '', enabled: true }));
        else {
          try { const v = JSON.parse(await ask('Объект источника JSON (url, name, type и др.): ')); if (!v || Array.isArray(v) || typeof v !== 'object') throw Error(); items.push(await field(`${key}[${items.length + 1}]`, v)); }
          catch { console.log('Некорректный JSON, элемент не добавлен.'); }
        }
      }
      return items;
    }
    if (value && !Array.isArray(value) && typeof value === 'object') {
      const result = {};
      for (const [k, v] of Object.entries(value)) result[k] = await field(`${key}.${k}`, v);
      return result;
    }
    const hidden = secret(key);
    const shown = hidden ? (value && !placeholder(value) ? 'задано, Enter сохранить' : 'не задано') : Array.isArray(value) ? value.join(', ') : value;
    while (true) {
      const raw = await ask(`${key} [${shown}]: `, hidden);
      if (!raw) return value;
      if (raw === '-' && (Array.isArray(value) || typeof value === 'string')) return Array.isArray(value) ? [] : '';
      try { return parseValue(raw, value); } catch (error) { console.log(error.message); }
    }
  }
  try {
    console.log('\nНастройка NewsDigestBot. Enter = сохранить; - = очистить строку/список.');
    console.log('Да/нет для переключателей; списки через запятую. Токены и пароли скрыты.');
    console.log('Telegram ID вводи целиком. В targets указываются получатели, не администраторы.\n');
    const order = ['telegram', 'ai', 'openai', 'google_ai', 'clodex', 'news_sources', 'digest', 'schedule', 'monitoring', 'updates', 'web'];
    for (const section of [...order, ...Object.keys(cfg).filter(k => !order.includes(k))]) {
      if (!(section in cfg)) continue;
      console.log(`\n${LABELS[section] || section}`);
      const edit = await ask('Настроить этот раздел? [да]: ');
      if (!/^(нет|no|n)$/i.test(edit)) cfg[section] = await field(section, cfg[section]);
    }
    const provider = { google: 'google_ai', gemini: 'google_ai', chatgpt: 'openai' }[cfg.ai.provider] || cfg.ai.provider;
    if (!['openai', 'google_ai', 'clodex'].includes(provider)) throw new Error('ai.provider: openai, google или clodex');
    if (!['html', 'rich_html'].includes(cfg.ai.format)) throw new Error('ai.format: html или rich_html');
    updateSettings(cfg);
    if (cfg.web.enabled && (!cfg.web.password || placeholder(cfg.web.password))) throw new Error('Для web.enabled нужен настоящий пароль');
    if (fs.existsSync(file)) { const backup = `${file}.${Date.now()}.bak`; fs.copyFileSync(file, backup); fs.chmodSync(backup, 0o600); }
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
    console.log(`\nКонфигурация сохранена: ${file}`);
    console.log('Проверь настройки командой npm run validate. Изменения применятся после перезапуска.');
  } finally { muted = false; rl.close(); }
}
if (require.main === module) configure(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { merge, parseValue, secret, configure };
