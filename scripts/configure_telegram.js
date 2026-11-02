// Human-readable Telegram setup. All questions use the shared hidden-input transport.
const TYPES = [
  { value: 'channel', label: 'Канал', name: 'Мой канал' },
  { value: 'supergroup', label: 'Супергруппа', name: 'Моя супергруппа' },
  { value: 'private', label: 'Личные сообщения', name: 'Личные сообщения' },
  { value: 'group', label: 'Обычная группа', name: 'Моя группа' }
];
const placeholder = value => !value || /^(YOUR_|CHANGE_ME|PASTE_)/i.test(String(value));
function booleanAnswer(raw) {
  if (/^(да|д|yes|y|true|1)$/i.test(raw)) return true;
  if (/^(нет|н|no|n|false|0)$/i.test(raw)) return false;
  throw new Error('Введи «да» или «нет».');
}
async function askBoolean(ask, label, fallback, log = console.log) {
  while (true) {
    const answer = (await ask(`${label} [${fallback ? 'да' : 'нет'}]: `)).trim();
    if (!answer) return fallback;
    try { return booleanAnswer(answer); } catch (error) { log(error.message); }
  }
}
async function choose(ask, label, choices, fallback, log = console.log) {
  choices.forEach((choice, index) => log(`  ${index + 1}. ${choice.label}`));
  const defaultIndex = Math.max(0, choices.findIndex(choice => choice.value === fallback));
  while (true) {
    const answer = (await ask(`${label} [${defaultIndex + 1}]: `)).trim();
    if (!answer) return choices[defaultIndex].value;
    const byNumber = /^\d+$/.test(answer) ? choices[Number(answer) - 1] : null;
    const match = byNumber || choices.find(choice => choice.value === answer.toLowerCase() || choice.label.toLowerCase() === answer.toLowerCase());
    if (match) return match.value;
    log(`Введи номер от 1 до ${choices.length}.`);
  }
}
function validChatId(value, type) {
  if (type !== 'private' && /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value)) return true;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return false;
  if (type === 'private') return Number(value) > 0;
  if (type === 'group') return Number(value) < 0;
  return /^-100\d+$/.test(value);
}
async function configureTelegram(current, ask, log = console.log) {
  const telegram = { ...current };
  log('\n1. Подключение бота');
  log('Токен выдает @BotFather. При вводе он не отображается.');
  while (true) {
    const answer = await ask(`Токен бота [${placeholder(telegram.bot_token) ? 'нужно ввести' : 'сохранён, Enter оставить'}]: `, true);
    const token = answer || telegram.bot_token;
    if (typeof token === 'string' && /^\d{5,}:[a-zA-Z0-9_-]{20,}$/.test(token)) { telegram.bot_token = token; break; }
    log('Нужен токен из @BotFather в формате число:ключ.');
  }
  log('\n2. Администраторы');
  log('Укажи свой Telegram ID. Несколько ID можно ввести через запятую.');
  const currentIds = (telegram.allowed_user_ids || []).map(String).filter(id => /^\d+$/.test(id));
  while (true) {
    const answer = await ask(`ID администраторов [${currentIds.join(', ') || 'нужно ввести'}]: `);
    const ids = answer ? answer.split(/[,;\s]+/).filter(Boolean) : currentIds;
    if (ids.length && ids.every(id => /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0)) {
      telegram.allowed_user_ids = [...new Set(ids)]; break;
    }
    log('Введи положительный числовой Telegram ID, например 123456789.');
  }
  log('\n3. Куда отправлять новости');
  log('Для канала добавь бота в администраторы с правом публикации.');
  log('Для личных сообщений сначала отправь боту /start.');
  const targets = [];
  async function editTarget(previous = {}) {
    log('\nТип получателя:');
    const type = await choose(ask, 'Выбери тип', TYPES, previous.type || 'channel', log);
    const selected = TYPES.find(entry => entry.value === type);
    const hint = type === 'private' ? 'твой положительный Telegram ID' : type === 'group' ? 'отрицательный ID группы' : '@имя_канала или ID вида -1001234567890';
    log(`Адрес получателя: ${hint}.`);
    let chatId;
    const oldId = placeholder(previous.chat_id) ? '' : String(previous.chat_id);
    while (true) {
      chatId = (await ask(`ID или @имя [${oldId || 'нужно ввести'}]: `)) || oldId;
      if (validChatId(chatId, type)) break;
      log(`Некорректный адрес. Укажи ${hint}.`);
    }
    const oldName = placeholder(previous.name) ? selected.name : previous.name;
    const name = (await ask(`Название для себя [${oldName}]: `)) || oldName;
    const enabled = await askBoolean(ask, 'Отправлять сюда новости?', previous.enabled !== false, log);
    const target = { ...previous, type, chat_id: chatId, name, enabled };
    log(`Получатель: ${name} · ${selected.label} · ${chatId} · ${enabled ? 'включён' : 'отключён'}`);
    return target;
  }
  // Template placeholders are examples, not real destinations to configure one by one.
  for (const target of (telegram.targets || []).filter(target => !placeholder(target.chat_id))) {
    log(`\nПолучатель: ${target.name || target.chat_id} (${target.chat_id})`);
    const action = await choose(ask, 'Что сделать с получателем?', [
      { value: 'edit', label: 'Изменить настройки' },
      { value: 'keep', label: 'Оставить как есть' },
      { value: 'delete', label: 'Удалить из списка' }
    ], 'keep', log);
    if (action === 'edit') targets.push(await editTarget(target));
    if (action === 'keep') targets.push(target);
  }
  if (!targets.length) { log('\nДобавим первого получателя.'); targets.push(await editTarget()); }
  while (await askBoolean(ask, 'Добавить ещё одного получателя?', false, log)) targets.push(await editTarget());
  telegram.targets = targets;
  log('\n4. Оформление сообщений');
  telegram.disable_web_page_preview = !(await askBoolean(ask, 'Показывать превью ссылок?', !telegram.disable_web_page_preview, log));
  const footer = placeholder(telegram.footer_text) ? '' : telegram.footer_text;
  const answer = await ask(`Подпись под постами (необязательно; - убрать) [${footer || 'без подписи'}]: `);
  telegram.footer_text = answer === '-' ? '' : answer || footer;
  log(`\nTelegram настроен. Получателей: ${targets.length}, включено: ${targets.filter(target => target.enabled !== false).length}.`);
  return telegram;
}
module.exports = { configureTelegram, choose, askBoolean, validChatId };
