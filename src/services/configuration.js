const fs = require('fs');
const path = require('path');
const { resolveLlm } = require('./llm_config');
const { updateSettings } = require('./auto_updater');
const { validChatId } = require('../../scripts/configure_telegram');
const SECRET = /^(?:bot_token|api[_-]?key|access_key|password|token|secret|authorization)$/i;
const missing = value => !value || /^(YOUR_|CHANGE_ME|PASTE_)/.test(String(value));
function merge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const result = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(extra || {})])) {
      if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Недопустимое имя параметра');
      result[key] = key in base ? merge(base[key], extra?.[key]) : extra[key];
    }
    return result;
  }
  return extra === undefined ? base : extra;
}
function maskSecrets(value, keys = [], prefix = '') {
  if (Array.isArray(value)) return value.map((item, i) => maskSecrets(item, keys, `${prefix}.${i}`));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (SECRET.test(key)) { if (!missing(item)) keys.push(name); return [key, '']; }
    return [key, maskSecrets(item, keys, name)];
  }));
}
function preserveSecrets(previous, incoming) {
  if (Array.isArray(incoming)) return incoming.map((v,i) => preserveSecrets(v&&typeof v==='object'&&v.url?(previous||[]).find(old=>old.url===v.url&&old.name===v.name):previous?.[i],v));
  if (!incoming || typeof incoming !== 'object') return incoming;
  const result = {};
  for (const [key,value] of Object.entries(incoming)) {
    if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Недопустимое имя параметра');
    result[key] = SECRET.test(key) && value === '' ? previous?.[key] || '' : SECRET.test(key) && value === '-' ? '' : preserveSecrets(previous?.[key],value);
  }
  return result;
}
function validate(config, ready = false) {
  const errors = [];
  const fail = (ok, text) => { if (!ok) errors.push(text); };
  const number = (value,min,max,label) => fail(typeof value === 'number' && Number.isFinite(value) && value>=min && value<=max,`${label}: допустимо от ${min} до ${max}`);
  const http = value => { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } };
  try { updateSettings(config); } catch (e) { errors.push(e.message); }
  fail(['html','rich_html'].includes(config.ai?.format),'Выбери HTML или Rich HTML');
  for (const section of ['telegram','ai','digest','schedule','news_sources','web','monitoring','updates']) fail(config[section] && typeof config[section] === 'object' && !Array.isArray(config[section]),`Не заполнен раздел ${section}`);
  if (errors.length) return errors;
  fail(Array.isArray(config.telegram.targets),'Получатели должны быть списком');
  for (const [i,t] of (Array.isArray(config.telegram.targets)?config.telegram.targets:[]).entries()) {
    fail(t && ['channel','supergroup','group','private'].includes(t.type),`Получатель ${i+1}: выбери тип`);
    fail(t && validChatId(String(t.chat_id||''),t.type),`Получатель ${i+1}: некорректный ID или @имя`);
  }
  fail(Array.isArray(config.telegram.allowed_user_ids) && config.telegram.allowed_user_ids.every(id => /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id)>0),'Администраторы: введи положительные числовые Telegram ID');
  number(config.digest.items_count,1,30,'Количество новостей');
  for (const key of ['russia_focused','international']) number(config.digest[key],0,30,'Количество новостей в категории');
  fail(config.digest.russia_focused+config.digest.international===config.digest.items_count,'Сумма российских и международных новостей должна совпадать с общим количеством');
  number(config.digest.lookback_hours,1,720,'Возраст новостей, часов');
  number(config.digest.max_candidates_for_llm,1,100,'Кандидаты для ИИ');
  number(config.digest.max_llm_calls_per_run,1,30,'Лимит вызовов ИИ');
  number(config.digest.max_input_chars_per_item,100,20000,'Длина исходного материала');
  number(config.digest.dedup_similarity,0,1,'Порог похожести');
  number(config.digest.memory_days,1,3650,'Хранение истории');
  fail(['single','digest'].includes(config.digest.mode),'Выбери режим публикации');
  const schedule=config.schedule;
  number(schedule.interval_min_minutes,0,1440,'Минимальный интервал');
  number(schedule.interval_max_minutes,0,1440,'Максимальный интервал');
  if (schedule.interval_min_minutes>0) fail(schedule.interval_max_minutes>=schedule.interval_min_minutes,'Максимальный интервал должен быть не меньше минимального');
  else { try { fail(require('node-cron').validate(schedule.cron||''),'Некорректное cron-расписание'); } catch { errors.push('Не удалось проверить cron-расписание'); } }
  fail(typeof schedule.timezone==='string'&&schedule.timezone.length>0,'Укажи часовой пояс');
  try { new Intl.DateTimeFormat('ru',{timeZone:schedule.timezone}); } catch { errors.push('Некорректный часовой пояс'); }
  fail(Array.isArray(config.news_sources.rss_feeds) && config.news_sources.rss_feeds.every(http),'RSS: укажи HTTP(S)-адреса лент');
  for (const key of ['openai','google_ai','clodex','custom']) {
    const cfg=config[key]; if (!cfg) continue;
    number(cfg.timeout_ms,1000,300000,`${key}: таймаут`);
    number(cfg.max_output_tokens,128,32768,`${key}: лимит токенов`);
    if (cfg.base_url && !http(cfg.base_url)) errors.push(`${key}: неверный Base URL`);
  }
  const providers={google:'google_ai',gemini:'google_ai',chatgpt:'openai'};
  const selected=providers[config.ai.provider]||config.ai.provider;
  fail(['openai','google_ai','clodex','custom'].includes(selected),'Выбери ИИ-провайдера');
  if (selected==='custom' && config.custom?.base_url) { try { resolveLlm(config); } catch(e) { errors.push(e.message); } }
  number(config.updates.intervalSeconds,60,86400,'Период проверки обновлений, секунды');
  for(const provider of ['openai','google_ai','custom','clodex'])for(const key of ['input_usd_per_million','output_usd_per_million','usd_per_million_tokens']) {
    const value=config.monitoring[provider]?.[key];if(value!==null&&value!==undefined)number(value,0,1000000,'Цена API');
  }
  if (config.web.enabled) {
    number(config.web.port,1,65535,'Порт панели');
    fail(!missing(config.web.password),'Задай пароль панели');
  }
  if (config.web.duckdns?.enabled) {
    fail(/^[a-z0-9-]+\.duckdns\.org$/.test(config.web.duckdns.domain||''),'DuckDNS: укажи поддомен вида name.duckdns.org');
    fail(!missing(config.web.duckdns.token),'DuckDNS: укажи токен аккаунта');
    number(config.web.duckdns.interval_minutes,1,1440,'Период обновления DuckDNS, минуты');
  }
  fail(Array.isArray(config.news_sources.custom),'Пользовательские источники должны быть списком');
  for(const source of Array.isArray(config.news_sources.custom)?config.news_sources.custom:[])if(source.enabled)fail(http(source.url),'У пользовательского источника должен быть HTTP(S)-адрес');
  if (ready) {
    for(const key of ['newsapi','gnews','mediastack'])if(config.news_sources[key]?.enabled)fail(!missing(config.news_sources[key].api_key)||!missing(config.monitoring.free_limits?.[key]?.api_key),`Введи API-ключ источника ${key} или выключи его`);

    fail(/^\d{5,}:[a-zA-Z0-9_-]{20,}$/.test(config.telegram.bot_token||''),'Введи токен Telegram-бота из @BotFather');
    fail(config.telegram.allowed_user_ids.length>0,'Добавь хотя бы одного администратора');
    fail(config.telegram.targets.some(t=>t.enabled!==false),'Добавь хотя бы одного включённого получателя');
    const llm=config[selected]||{};
    fail(llm.enabled!==false,'Выбранный ИИ-провайдер отключён');
    fail(!missing(llm.api_key),'Введи API-ключ выбранного ИИ-провайдера');
    fail(!missing(llm.model),'Укажи модель выбранного ИИ-провайдера');
    if(selected==='custom') { try { resolveLlm(config); } catch(e) { errors.push(e.message); } }
  }
  return [...new Set(errors)];
}
function prepareConfig(example, current = {}) {
  const config=merge(example,current);
  config.telegram.targets=(config.telegram.targets||[]).filter(t=>!missing(t.chat_id));
  config.telegram.allowed_user_ids=(config.telegram.allowed_user_ids||[]).filter(id=>!missing(id));
  if(missing(config.telegram.footer_text))config.telegram.footer_text='';
  for(const key of ['newsapi','gnews','mediastack']) if(missing(config.news_sources[key]?.api_key))config.news_sources[key].enabled=false;
  if(!current.setup) config.setup={completed:validate(config,true).length===0};
  return config;
}
function saveConfig(file,config) {
  if(fs.existsSync(file)) { fs.copyFileSync(file,file+'.previous.bak'); fs.chmodSync(file+'.previous.bak',0o600); }
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);fs.chmodSync(file,0o600);
}
module.exports={merge,maskSecrets,preserveSecrets,validate,prepareConfig,saveConfig,missing};
