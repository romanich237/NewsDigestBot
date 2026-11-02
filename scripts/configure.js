#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const { configureTelegram, askBoolean, choose } = require('./configure_telegram');
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
  console.log('Панель позволит настроить Telegram, ИИ, источники и расписание в браузере.');
  web.auto_ssl = await yesNo('Автоматически настроить Nginx и SSL от Let’s Encrypt?', web.auto_ssl !== false);
  console.log('Выбери домен: свой домен с DNS-записью на сервер или бесплатный поддомен DuckDNS.');
  const domainType = await choose(ask, 'Тип домена', [{value:'own',label:'Свой домен'}, {value:'duckdns',label:'DuckDNS — name.duckdns.org'}], web.duckdns?.enabled?'duckdns':'own');
  if (domainType === 'duckdns') {
    const {normalizeDomain}=require('../src/services/duckdns');
    console.log('Создай поддомен в аккаунте https://www.duckdns.org и скопируй токен аккаунта. Сам аккаунт установщик не создаёт.');
    let domain;
    while(true) {
      const value=await ask(`Поддомен DuckDNS [${web.duckdns?.domain||''}]: `);
      try {domain=normalizeDomain(value||web.duckdns?.domain);break;} catch(error){console.log(error.message);}
    }
    let token=web.duckdns?.token;
    while(!token||placeholder(token))token=await ask('Токен аккаунта DuckDNS (скрытый ввод): ',true);
    web.domain=domain;web.duckdns={...web.duckdns,enabled:true,domain,token,interval_minutes:web.duckdns?.interval_minutes||5};
  } else {
    web.duckdns={...web.duckdns,enabled:false};
    while (true) {
      const raw = await ask(`Домен веб-панели без https:// [${web.domain || ''}]: `);
      const domain = (raw === '-' ? '' : raw || web.domain || '').replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
      if ((!domain && !web.auto_ssl) || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) { web.domain = domain; break; }
      console.log('Для автоматического SSL нужен домен, например bot.example.com. Его DNS должен указывать на сервер.');
    }
  }
  web.random_port = await yesNo('Автоматически подобрать свободный внутренний порт для Nginx?', web.random_port !== false);
  if(!web.random_port) {
    while (true) {
      const raw = await ask(`Внутренний порт веб-панели [${web.port || 3000}]: `);
      const port = Number(raw || web.port || 3000);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) { web.port = port; break; }
      console.log('Порт должен быть от 1 до 65535.');
    }
  } else web.port=web.port||3000;
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
async function configure(file = path.resolve(__dirname, '../config.json'), options = {}) {
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.example.json'), 'utf8'));
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const {prepareConfig}=require('../src/services/configuration');
  const cfg = prepareConfig(example, existing);
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
    console.log('Тип получателя выбирается по номеру. Примеры каналов не добавляются автоматически.\n');
    if(options.webOnly) {
      console.log('Сейчас нужны только домен, SSL и пароль панели. Остальные настройки будут в браузере.');
      cfg.web=await configureWeb({...cfg.web,enabled:true},ask);
      if(!cfg.web.enabled)throw new Error('Для настройки в браузере нужна веб-панель. Выбери терминальную настройку в установщике, если она не нужна.');
    }
    const order = ['telegram', 'ai', 'openai', 'google_ai', 'clodex', 'custom', 'news_sources', 'digest', 'schedule', 'monitoring', 'updates', 'web'];
    for (const section of options.webOnly ? [] : [...order, ...Object.keys(cfg).filter(k => !order.includes(k) && k !== 'setup')]) {
      if (!(section in cfg)) continue;
      console.log(`\n${LABELS[section] || section}`);
      if (section === 'web') { cfg.web = await configureWeb(cfg.web, ask); continue; }
      const edit = await askBoolean(ask, 'Настроить этот раздел?', true);
      if (edit) cfg[section] = section === 'telegram' ? await configureTelegram(cfg.telegram, ask) : await field(section, cfg[section]);
    }
    const provider = { google: 'google_ai', gemini: 'google_ai', chatgpt: 'openai' }[cfg.ai.provider] || cfg.ai.provider;
    if (!['openai', 'google_ai', 'clodex', 'custom'].includes(provider)) throw new Error('ai.provider: openai, google, clodex или custom');
    if (!['html', 'rich_html'].includes(cfg.ai.format)) throw new Error('ai.format: html или rich_html');
    if(!options.webOnly) { resolveLlm(cfg);cfg.setup={completed:true}; }
    updateSettings(cfg);
    if (cfg.web.enabled && (!cfg.web.password || placeholder(cfg.web.password))) throw new Error('Для web.enabled нужен настоящий пароль');
    if (fs.existsSync(file)) { const backup = `${file}.${Date.now()}.bak`; fs.copyFileSync(file, backup); fs.chmodSync(backup, 0o600); }
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
    console.log(`\nКонфигурация сохранена: ${file}`);
    console.log(options.webOnly ? 'Установщик подготовит адрес панели. Остальные настройки заполни в браузере и нажми «Сохранить и включить бота».' : 'Проверь настройки командой npm run validate. Изменения применятся после перезапуска.');
  } finally { muted = false; rl.close(); }
}
if (require.main === module) configure(process.argv.slice(2).find(arg=>!arg.startsWith('--')), {webOnly:process.argv.includes('--web-only')}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { merge, parseValue, secret, configure, configureWeb };
