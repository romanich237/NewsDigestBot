#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const { resolveLlm } = require('../src/services/llm_config');
const { updateSettings } = require('../src/services/auto_updater');
const LABELS = {
  telegram: 'Telegram: бот, администраторы и получатели', ai: 'Выбор ИИ и формат постов',
  custom: 'Свой OpenAI-совместимый API: URL, ключ и модель', openai: 'OpenAI', google_ai: 'Google Gemini', clodex: 'CLODEX', news_sources: 'Источники новостей',
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
async function configureWeb(current, ask) {
  const web = { ...current };
  async function yesNo(label, fallback) {
    while (true) {
      const raw = await ask(`${label} [${fallback ? 'да' : 'нет'}]: `);
      if (!raw) return fallback;
      try { return parseValue(raw, true); } catch { console.log('Введи да или нет.'); }
    }
  }
  web.enabled = await yesNo('Нужна веб-панель?', web.enabled === true);
  if (!web.enabled) return web;
  web.auto_ssl = await yesNo('Автоматически настроить Nginx и SSL от Let’s Encrypt?', web.auto_ssl !== false);
  while (true) {
    const raw = await ask(`Домен веб-панели без https:// [${web.domain || ''}]: `);
    const domain = (raw === '-' ? '' : raw || web.domain || '').replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    if ((!domain && !web.auto_ssl) || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) { web.domain = domain; break; }
    console.log('Для автоматического SSL нужен домен, например bot.example.com. Его DNS должен указывать на сервер.');
  }
  while (true) {
    const raw = await ask(`Внутренний порт веб-панели [${web.port || 3000}]: `);
    const port = Number(raw || web.port || 3000);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) { web.port = port; break; }
    console.log('Порт должен быть от 1 до 65535.');
  }
  web.host = web.auto_ssl ? '127.0.0.1' : (await ask(`Адрес прослушивания web.host [${web.host || '0.0.0.0'}]: `)) || web.host || '0.0.0.0';
  while (true) {
    const raw = await ask(`Пароль веб-панели [${web.password && !placeholder(web.password) ? 'задан, Enter сохранить' : 'не задан'}]: `, true);
    const password = raw || web.password;
    if (password && !placeholder(password)) { web.password = password; break; }
    console.log('Укажи пароль для входа в панель.');
  }
  if (web.auto_ssl) {
    while (true) {
      const raw = await ask(`Email для уведомлений Let’s Encrypt (можно пропустить) [${web.ssl_email || ''}]: `);
      const email = raw === '-' ? '' : raw || web.ssl_email || '';
      if (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { web.ssl_email = email; break; }
      console.log('Укажи email или - для очистки.');
    }
  }
  return web;
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
    const order = ['telegram', 'ai', 'openai', 'google_ai', 'clodex', 'custom', 'news_sources', 'digest', 'schedule', 'monitoring', 'updates', 'web'];
    for (const section of [...order, ...Object.keys(cfg).filter(k => !order.includes(k))]) {
      if (!(section in cfg)) continue;
      console.log(`\n${LABELS[section] || section}`);
      if (section === 'web') { cfg.web = await configureWeb(cfg.web, ask); continue; }
      const edit = await ask('Настроить этот раздел? [да]: ');
      if (!/^(нет|no|n)$/i.test(edit)) cfg[section] = await field(section, cfg[section]);
    }
    const provider = { google: 'google_ai', gemini: 'google_ai', chatgpt: 'openai' }[cfg.ai.provider] || cfg.ai.provider;
    if (!['openai', 'google_ai', 'clodex', 'custom'].includes(provider)) throw new Error('ai.provider: openai, google, clodex или custom');
    if (!['html', 'rich_html'].includes(cfg.ai.format)) throw new Error('ai.format: html или rich_html');
    resolveLlm(cfg);
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
module.exports = { merge, parseValue, secret, configure, configureWeb };
