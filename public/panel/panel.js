'use strict';
const $=id=>document.getElementById(id);
let config={},secrets=new Set(),csrf='',revision='',current='overview',sequence=0;
const invalidJSON=new Set();
const SECTIONS=[
 ['overview','Обзор','Состояние и публикации',[]],
 ['telegram','Telegram','Подключи бота, укажи администраторов и получателей. ID администратора — это твой аккаунт, а ID получателя — чат или канал, куда будут приходить новости.',['telegram']],
 ['ai','Искусственный интеллект','Выбери один провайдер и заполни его ключ и модель. Остальные подключения можно оставить незаполненными. Для своего сервера выбери «Свой API» и введи Base URL.',['ai','openai','google_ai','clodex','custom']],
 ['news','Источники новостей','RSS работает без API-ключа. Новостные API включай только при наличии ключа. У каждого источника свои ограничения; необязательно подключать все сразу.',['news_sources']],
 ['digest','Содержание постов','Определи темы, количество и глубину обработки. Больше кандидатов и более длинные описания увеличивают расход токенов.',['digest']],
 ['schedule','Расписание','Задай интервал в минутах. Одинаковые значения дают фиксированную паузу, разные — случайную. Для cron установи оба интервала в 0.',['schedule']],
 ['updates','Автообновление','Обновление выполняется из выбранной ветки GitHub под PM2/systemd. Проверка не чаще раза в минуту. Настройки и база сохраняются.',['updates']],
 ['monitoring','Цены и лимиты','Это локальный учёт расходов, а не баланс провайдера. Для своего API обязательно укажи отдельные цены входа и выхода за миллион токенов.',['monitoring']],
 ['web','Панель и DuckDNS','Пароль можно сменить здесь. Домен, SSL и внутренний порт задаёт установщик: они показаны для справки. Для смены инфраструктуры повтори установку. Токен DuckDNS можно обновить в этой форме.',['web']]
];
const META={
 telegram:['Telegram','Для канала назначь бота администратором с правом публикации. Для личных сообщений сначала отправь ему /start.'],
 bot_token:['Токен бота','Получается в @BotFather командой /newbot. Это секретный ключ вида 123456789:AA…; имя бота вместо токена не подходит.'],
 allowed_user_ids:['Администраторы бота','Твои положительные числовые Telegram ID. Несколько ID введи по одному на строку или через запятую. Не указывай здесь ID канала.'],
 targets:['Получатели публикаций','Добавь канал, группу или личный чат. Каждый включённый получатель получает новости автоматически; выключенный остаётся в настройках.'],
 type:['Тип получателя','Канал: публикации подписчикам. Супергруппа/группа: общий чат. Личные сообщения: твой аккаунт после команды /start.'],
 chat_id:['ID или @имя получателя','Для канала подходит @public_channel или ID вида -1001234567890. Для личных сообщений нужен положительный ID пользователя.'],
 name:['Название для себя','Любое понятное название. Оно помогает различать подключения и не меняет имя канала в Telegram.'],
 enabled:['Включено','Выключенный источник или получатель не используется. Для выбранного ИИ-провайдера включение обязательно.'],
 footer_text:['Подпись под постами','Необязательный текст в конце публикации. Например, название канала и @username. Оставь пустым, если подпись не нужна.'],
 parse_mode:['Формат обычных сообщений','Оставь HTML: бот формирует HTML-разметку. Формат ИИ-постов выбирается отдельно в разделе искусственного интеллекта.'],
 disable_web_page_preview:['Отключить превью ссылок','Если включено, обычные сообщения не будут содержать карточку предпросмотра сайта. Rich Messages обрабатывают ссылки своим способом.'],
 ai:['Выбор провайдера','Одновременно используется одно подключение. Выбери провайдер, затем заполни его раздел ниже.'],
 provider:['Провайдер ИИ','OpenAI и Google используют официальные API. CLODEX — отдельный сервис. «Свой API» подходит для OpenAI-совместимых сервисов и локальных серверов.'],
 format:['Формат ИИ-постов','Rich HTML поддерживает таблицы, заголовки и раскрываемые блоки. Обычный HTML подходит для простых сообщений; таблицы оформляются текстом.'],
 openai:['OpenAI','Нужен API-ключ платформы OpenAI и точный идентификатор доступной модели.'],
 google_ai:['Google Gemini','Ключ создаётся в Google AI Studio. Вызовы идут через нативный API Gemini.'],
 clodex:['CLODEX','Введи ключ, Base URL и модель, доступные у этого сервиса.'],
 custom:['Своё подключение','Здесь можно указать OpenAI-совместимый API. Для пользовательского JSON-источника задаются URL, метод и пути к данным.'],
 base_url:['Base URL сервиса','Базовый адрес API с нужной версией, например https://api.example.com/v1. В своём API также можно указать полный /chat/completions.'],
 api_key:['API-ключ','Секретный ключ выбранного сервиса. Он отправляется серверу только при сохранении и не возвращается в браузер.'],
 model:['Модель','Точный идентификатор из каталога сервиса, например gemini-2.5-flash-lite. Название должно быть доступно по указанному API-ключу.'],
 timeout_ms:['Ожидание ответа, миллисекунды','90000 означает 90 секунд. Слишком маленькое значение может прерывать медленную генерацию.'],
 max_output_tokens:['Максимум выходных токенов','Лимит всего ответа модели, включая все новости и возможные рассуждения. При обрыве JSON увеличь лимит или сократи выпуск.'],
 temperature:['Температура','Меньше — более предсказуемый текст. Для моделей без поддержки температуры оставь параметр незаданным.'],
 token_parameter:['Поле лимита токенов','Большинство совместимых серверов принимает max_tokens; некоторые модели требуют max_completion_tokens. Выбери согласно документации сервиса.'],
 news_sources:['Источники','Бот получает описания из RSS и API; полные тексты по произвольным ссылкам автоматически не скачиваются.'],
 rss_feeds:['RSS-ленты','Полные HTTP(S)-адреса RSS, по одному на строку. Например https://habr.com/ru/rss/all/all/. Ключ не требуется.'],
 newsapi:['NewsAPI','Дополнительный источник новостей. Включи его и укажи собственный API-ключ.'],
 gnews:['GNews','Дополнительный источник. Язык, страна и категории ограничивают получаемую выборку.'],
 mediastack:['Mediastack','API новостей. Доступные языки и квоты зависят от тарифа.'],
 categories:['Категории','Категории API через запятую или по одной на строку, например technology и science. Названия должны поддерживаться сервисом.'],
 language:['Язык','Код языка материалов, например ru для русского.'],
 country:['Страна','Код страны, например ru. Поддержка зависит от новостного API.'],
 page_size:['Размер выборки','Максимальное число материалов на запрос. Увеличение может расходовать квоту источника.'],
 url:['URL источника','Полный HTTP(S)-адрес RSS-ленты или JSON API.'],
 method:['HTTP-метод','Обычно GET. Используй POST только если его требует твой источник.'],
 headers:['Заголовки запроса','JSON-объект заголовков: например {"Accept":"application/json"}. Authorization считается секретным полем.'],
 params:['Параметры запроса','JSON-объект параметров API. Не указывай секреты в адресах, доступных посторонним.'],
 items_path:['Путь к списку новостей','Путь внутри JSON-ответа, например articles или data.items.'],
 fields:['Поля JSON-источника','Пути к заголовку, описанию, ссылке и времени внутри каждого элемента ответа.'],
 title:['Заголовок','Имя или путь поля заголовка в ответе собственного источника.'],
 description:['Описание','Имя или путь поля короткого описания в JSON-ответе.'],
 published_at:['Время публикации','Имя или путь поля даты в JSON-ответе источника.'],
 source:['Источник','Имя или путь поля названия издания в JSON-ответе.'],
 digest:['Выпуск','Настройки общего выпуска и отдельных публикаций.'],
 mode:['Режим публикации','«Отдельные посты»: каждая новость отдельным сообщением. «Дайджест»: все новости одним сообщением.'],
 items_count:['Всего новостей','Сумма российских и международных новостей должна совпадать с этим числом.'],
 russia_focused:['Российских новостей','Сколько материалов, связанных с Россией, включать в выпуск.'],
 international:['Международных новостей','Сколько остальных материалов включать в выпуск.'],
 keywords:['Интересующие темы','Слова и темы для отбора. Они помогают ИИ и локальному фильтру оценить подходящие материалы.'],
 exclude_keywords:['Исключить темы','Материалы с этими словами отбрасываются до генерации.'],
 lookback_hours:['Возраст новостей, часы','Материалы старше этого значения не используются. 48 означает последние двое суток.'],
 max_candidates_for_llm:['Кандидатов передать ИИ','Число свежих материалов в одном запросе. Меньше кандидатов — дешевле обработка, но меньше выбор.'],
 dedup_similarity:['Порог похожести','Значение от 0 до 1. Чем ниже, тем строже отбор похожих заголовков; 0.86 — исходное значение.'],
 memory_days:['История публикаций, дни','Сколько дней хранить сведения о ранее отправленных материалах.'],
 max_llm_calls_per_run:['Максимум вызовов ИИ','Ограничение повторной обработки за выпуск. Запасной сценарий может делать дополнительные платные запросы.'],
 max_input_chars_per_item:['Символов исходника на новость','Какую часть описания передавать модели. Больший объём расходует больше входных токенов.'],
 inline_url:['Ссылка прямо в тексте','Для обычной карточки добавляет открытый URL вместо ссылки в заголовке. Оформленный ИИ-пост сохраняет свои ссылки.'],
 schedule:['Расписание','Время работы считается в заданном часовом поясе.'],
 cron:['Cron-выражение','Например 0 * * * * — каждый час. Используется только при минимальном интервале 0.'],
 timezone:['Часовой пояс','Например Europe/Moscow. Используется для cron-расписания.'],
 interval_min_minutes:['Минимальная пауза, минуты','30 означает не раньше чем через 30 минут. Поставь 0, чтобы использовать cron.'],
 interval_max_minutes:['Максимальная пауза, минуты','Не меньше минимальной. При 30 и 60 бот выбирает случайную паузу в этом диапазоне.'],
 updates:['GitHub-обновления','Проверка и установка новых коммитов. Ручные изменения файлов могут блокировать обновление.'],
 autoInstall:['Устанавливать автоматически','Если выключено, бот только проверяет наличие новой версии.'],
 intervalSeconds:['Проверка каждые, секунды','Минимум 60. Проверка не зависит от расписания публикаций.'],
 repository:['GitHub-репозиторий','Формат owner/name. По умолчанию romanich237/NewsDigestBot.'],
 branch:['Ветка','Обычно main. Для Git-установки должна совпадать с текущей рабочей веткой.'],
 monitoring:['Учёт API','Оценка расходов хранится локально и может отличаться от счёта провайдера.'],
 currency:['Курс валюты','Фиксированный курс для приблизительного перевода расходов в рубли.'],
 usd_rub:['Рублей за доллар','Курс задаётся вручную и не обновляется автоматически.'],
 usd_per_million_tokens:['Цена миллиона токенов, USD','Общая ставка CLODEX, если не заданы разные цены входа и выхода.'],
 input_usd_per_million:['Вход: USD за миллион токенов','Цена отправленных модели данных. Оставь незаданным для встроенной цены известной модели.'],
 output_usd_per_million:['Выход: USD за миллион токенов','Цена сгенерированного ответа. Для собственного API укажи тариф своего провайдера.'],
 free_limits:['Квоты провайдеров','Справочные значения для статистики. Они не изменяют тариф и не гарантируют бесплатные запросы.'],
 requests:['Количество запросов','Справочная квота сервиса на указанный период.'],
 period:['Период квоты','day — день, month — месяц, provider — условия сервиса.'],
 note:['Примечание','Пояснение, которое будет видно в статистике API.'],
 web:['Доступ к панели','Панель остаётся включённой при сохранении, чтобы не потерять доступ.'],
 port:['Внутренний порт','Выбран установщиком автоматически. Nginx направляет сюда запросы, внешняя ссылка работает по HTTPS без порта.'],
 host:['Адрес прослушивания','127.0.0.1 делает внутренний порт доступным только на сервере, снаружи работает Nginx.'],
 domain:['Домен','Адрес, открываемый в браузере. Домен и SSL меняются через установщик.'],
 password:['Новый пароль панели','Оставь пустым, чтобы сохранить пароль. После смены потребуется войти заново.'],
 auto_ssl:['Автоматический SSL','Выбор установщика: сертификат Let’s Encrypt и продление через certbot.timer.'],
 random_port:['Автоматический внутренний порт','Установщик выбирает свободный порт и записывает его в конфиг Nginx.'],
 ssl_email:['Email сертификата','Адрес для уведомлений Let’s Encrypt. Изменение регистрации сертификата требует установщика.'],
 duckdns:['DuckDNS','Поддерживает привязку поддомена duckdns.org к текущему IPv4 сервера. Сам поддомен сначала создай в своём аккаунте DuckDNS.'],
 token:['Токен DuckDNS','Секретный токен аккаунта с duckdns.org. Он нужен для обновления IP и не показывается после сохранения.'],
 interval_minutes:['Обновлять DNS каждые, минуты','Обычно 5 минут. Проверка выполняется на сервере независимо от генерации новостей.']
};
const ENUMS={
 'ai.provider':[['openai','OpenAI'],['google','Google Gemini'],['clodex','CLODEX'],['custom','Свой API']],
 'ai.format':[['rich_html','Rich HTML — таблицы и блоки'],['html','Обычный HTML']],
 'digest.mode':[['single','Отдельные посты'],['digest','Общий дайджест']],
 'telegram.parse_mode':[['HTML','HTML']],
 'custom.token_parameter':[['max_tokens','max_tokens'],['max_completion_tokens','max_completion_tokens']]
};
const LOCKED=new Set(['web.enabled','web.host','web.port','web.domain','web.auto_ssl','web.random_port','web.duckdns.domain']);
const secret=key=>/^(bot_token|api[_-]?key|access_key|password|token|secret|authorization)$/i.test(key);
function node(tag,attrs={},text){const el=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){if(key==='class')el.className=value;else el.setAttribute(key,value);}if(text!==undefined)el.textContent=text;return el;}
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;window.scrollTo({top:0,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth'});}
async function api(url,data){const r=await fetch(url,{method:data?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined});const result=await r.json();if(r.status===401){$('app').hidden=true;$('login').hidden=false;}if(!r.ok)throw new Error([result.error,...(result.errors||[])].join('\n'));return result;}
function setValue(parts,value){let at=config;for(const part of parts.slice(0,-1))at=at[part];at[parts.at(-1)]=value;}
function renderField(key,value,parts,parent){
 const full=parts.join('.');let meta=META[key]||[key.replace(/_/g,' '),'Дополнительная настройка. Значение сохраняется в конфигурации сервера.'];
 if(key==='type'&&parts[0]==='news_sources')meta=['Формат источника','RSS — обычная новостная лента. JSON API — ответ сервера, для которого ниже задаются пути к списку новостей и его полям.'];
 if(Array.isArray(value)&&((value[0]&&typeof value[0]==='object')||['telegram.targets','news_sources.custom'].includes(full))){
  const wrap=node('div',{class:'group'});wrap.append(node('h2',{},meta[0]),node('p',{class:'help'},meta[1]));
  if(!value.length)wrap.append(node('p',{class:'empty'},'Пока ничего не добавлено.'));
  value.forEach((item,i)=>{const box=node('div',{class:'array-item'});box.append(node('h2',{},item.name||`Получатель / источник ${i+1}`));const remove=node('button',{type:'button',class:'secondary remove'},'Удалить из списка');remove.onclick=()=>{value.splice(i,1);show(current);};box.append(remove);Object.entries(item).forEach(([k,v])=>renderField(k,v,[...parts,i,k],box));wrap.append(box);});
  const add=node('button',{type:'button',class:'secondary'},full==='telegram.targets'?'Добавить получателя':'Добавить источник');add.onclick=()=>{value.push(full==='telegram.targets'?{name:'Мой канал',type:'channel',chat_id:'',enabled:true}:{name:'Мой источник',enabled:false,type:'rss',url:'https://example.com/rss',method:'GET',headers:{},params:{},items_path:'items',fields:{title:'title',description:'description',url:'url',published_at:'publishedAt',source:'source'}});show(current);};wrap.append(add);parent.append(wrap);return;
 }
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  const wrap=node('div',{class:'group'});wrap.append(node('h2',{},meta[0]),node('p',{class:'help'},meta[1]));
  if(['headers','params'].includes(key)){jsonInput(value,parts,wrap);}else Object.entries(value).filter(([k])=>!(['news_sources.newsapi','news_sources.gnews','news_sources.mediastack'].includes(full)&&value.enabled===false&&k!=='enabled')).forEach(([k,v])=>renderField(k,v,[...parts,k],wrap));parent.append(wrap);return;
 }
 const field=node('div',{class:'field'}),id='field-'+(++sequence);field.append(node('label',{for:id},meta[0]));let input;
 let choices=ENUMS[full];
 if(key==='type'&&parts[0]==='telegram')choices=[['channel','Канал'],['supergroup','Супергруппа'],['private','Личные сообщения'],['group','Обычная группа']];
 if(key==='type'&&parts[0]==='news_sources')choices=[['rss','RSS-лента'],['json','JSON API']];
 if(choices){input=node('select',{id});for(const [v,label]of choices)input.append(node('option',{value:v},label));input.value=({google_ai:'google',gemini:'google',chatgpt:'openai'}[value]||value);input.onchange=()=>{setValue(parts,input.value);if(full==='ai.provider'){const provider=input.value==='google'?'google_ai':input.value;config[provider].enabled=true;show(current);}};}
 else if(typeof value==='boolean'){input=node('select',{id});input.append(node('option',{value:'true'},'Да'),node('option',{value:'false'},'Нет'));input.value=String(value);input.onchange=()=>{setValue(parts,input.value==='true');if(key==='enabled'&&parts[0]==='news_sources')show(current);};}
 else if(Array.isArray(value)){input=node('textarea',{id});input.value=value.join('\n');input.oninput=()=>setValue(parts,input.value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean));}
 else {const hidden=secret(key),numeric=typeof value==='number'||(key.endsWith('usd_per_million')||key==='temperature');input=node('input',{id,type:hidden?'password':numeric?'number':'text',autocomplete:hidden?'new-password':'off'});if(numeric)input.step='any';input.value=value??'';input.oninput=()=>setValue(parts,numeric?(input.value===''?null:Number(input.value)):input.value);if(hidden&&secrets.has(full))input.placeholder='Ключ сохранён — оставь пустым';}
 if(LOCKED.has(full)){input.disabled=true;input.classList.add('readonly');}
 field.append(input,node('p',{class:'help'},meta[1]+(secret(key)&&secrets.has(full)?' Значение уже сохранено. Чтобы заменить, введи новое; чтобы удалить, введи «-».':'')));parent.append(field);
}
function jsonInput(value,parts,parent){const area=node('textarea');area.value=JSON.stringify(value,null,2);area.setAttribute('aria-label','JSON параметров источника');area.oninput=()=>{try{const parsed=JSON.parse(area.value);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error();setValue(parts,parsed);area.setCustomValidity('');invalidJSON.delete(parts.join('.'));}catch{invalidJSON.add(parts.join('.'));area.setCustomValidity('Нужен корректный JSON-объект');}};parent.append(area);}
function show(name){current=name;for(const b of $('navigation').children)b.classList.toggle('active',b.dataset.section===name);$('overview').hidden=name!=='overview';$('editor').hidden=name==='overview';if(name==='overview')return;const section=SECTIONS.find(s=>s[0]===name);$('sectionTitle').textContent=section[1];$('sectionDescription').textContent=section[2];$('fields').replaceChildren();const keys=name==='ai'?['ai',({google:'google_ai',gemini:'google_ai',chatgpt:'openai'}[config.ai.provider]||config.ai.provider)]:section[3];for(const key of keys)if(config[key]!==undefined)renderField(key,config[key],[key],$('fields'));}
async function loadConfig(){invalidJSON.clear();const data=await api('/api/config');config=data.config;secrets=new Set(data.secrets);csrf=data.csrf;revision=data.revision;config.monitoring??={};for(const name of ['openai','google_ai','custom'])config.monitoring[name]??={input_usd_per_million:null,output_usd_per_million:null};$('login').hidden=true;$('app').hidden=false;show(data.status.setup?'telegram':current);await refresh();}
async function refresh(){try{const s=await api('/api/state');$('version').textContent='v'+s.version;$('stateTitle').textContent=s.setup?'Заверши настройку бота':s.ready?'Бот включён':'Бот остановлен';$('stateDescription').textContent=s.error||(s.ready?'Автопубликация включена. Можно изменить настройки или отправить выпуск вручную.':'Заполни настройки в разделах слева и нажми «Сохранить и включить бота». Публикации будут отправляться активным получателям по расписанию.');$('targetCount').textContent=s.targets;$('updateState').textContent=s.updates.error?'Ошибка проверки':s.updates.updateAvailable?'Доступно обновление':s.updates.checkedAt?'Актуально':'Ещё не проверено';$('report').textContent=s.report;$('runNow').disabled=!s.ready||s.busy;}catch(e){if(!$('app').hidden)message(e.message,true);}}
async function save(activate){if(invalidJSON.size){message('Исправь JSON параметров источника перед сохранением.',true);show('news');return;}for(const input of $('fields').querySelectorAll('textarea'))if(!input.reportValidity())return;const buttons=[$('activate'),$('saveDraft')];buttons.forEach(b=>b.disabled=true);try{const result=await api('/api/config',{config,activate,revision});message(result.message);await loadConfig();}catch(e){message(e.message,true);}finally{buttons.forEach(b=>b.disabled=false);}}
$('loginForm').onsubmit=async event=>{event.preventDefault();try{const result=await api('/api/login',{password:$('password').value});csrf=result.csrf;$('password').value='';await loadConfig();}catch(e){$('loginError').textContent=e.message;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{});}finally{location.reload();}};
$('activate').onclick=()=>save(true);$('saveDraft').onclick=()=>save(false);$('refresh').onclick=refresh;
$('runNow').onclick=async()=>{if(!confirm('Опубликовать новые новости первому активному получателю прямо сейчас?'))return;$('runNow').disabled=true;try{const result=await api('/api/run',{});message('Отправлено сообщений: '+result.sent);}catch(e){message(e.message,true);}finally{await refresh();}};
for(const [id,label]of SECTIONS){const button=node('button',{type:'button'},label);button.dataset.section=id;button.onclick=()=>show(id);$('navigation').append(button);}
loadConfig().catch(()=>{});setInterval(()=>{if(!$('app').hidden)refresh();},15000);
