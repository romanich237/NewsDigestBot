// Веб-панель управления NewsDigestBot. Без внешних зависимостей.
// createWebServer({config,persist,runNow,report,log}) -> http.Server
const http=require('http'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function page(host,port){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NewsDigestBot — панель управления</title><style>
:root{--bg:#0f1420;--card:#171e2e;--acc:#4f8cff;--ok:#3ecf8e;--err:#ff6b6b;--tx:#e8ecf4;--mut:#8a94a8}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--tx)}
.wrap{max-width:860px;margin:0 auto;padding:24px16px}h1{font-size:22px;margin:004px}.sub{color:var(--mut);margin-bottom:20px;font-size:13px}
.card{background:var(--card);border-radius:12px;padding:18px;margin-bottom:16px}h2{font-size:15px;margin:0012px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
label{display:block;margin:10px04px;font-size:13px;color:var(--mut)}input,select,textarea{width:100%;padding:9px11px;border-radius:8px;border:1px solid #2a3550;background:#0c111d;color:var(--tx);font:inherit}
textarea{min-height:64px;resize:vertical}button{padding:9px16px;border-radius:8px;border:0;background:var(--acc);color:#fff;font:inherit;cursor:pointer}button.ghost{background:#26304a}button:disabled{opacity:.5}
.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:140px}.msg{margin:10px0;padding:10px12px;border-radius:8px;font-size:14px;display:none}.msg.ok{display:block;background:rgba(62,207,142,.12);color:var(--ok)}.msg.err{display:block;background:rgba(255,107,107,.12);color:var(--err)}
pre{background:#0c111d;border-radius:8px;padding:12px;overflow:auto;font-size:12.5px;white-space:pre-wrap}.chk{display:flex;align-items:center;gap:8px;margin:10px0}.chk input{width:auto}
#login{max-width:360px;margin:80px auto}.stat{display:inline-block;margin:4px10px4px0;padding:6px12px;background:#0c111d;border-radius:8px;font-size:13px}
</style></head><body><div class="wrap" id="app" hidden>
<h1>🎛 NewsDigestBot</h1><div class="sub" id="host"></div>
<div class="msg" id="msg"></div>
<div class="card"><h2>Статус</h2><div id="status">…</div>
<div class="row" style="margin-top:12px"><button id="runNow">📰 Опубликовать дайджест сейчас</button><button class="ghost" id="refresh">↻ Обновить</button></div></div>
<div class="card"><h2>Настройки</h2>
<label>Режим публикаций</label><select id="mode"><option value="single">Одна новость — один пост</option><option value="digest">Единый дайджест</option></select>
<label>Интервал публикации, мин (мин / макс — случайный диапазон)</label>
<div class="row"><input id="ivMin" type="number" min="1" max="1440"><input id="ivMax" type="number" min="1" max="1440"></div>
<label class="chk"><input id="inlineUrl" type="checkbox"> Ссылка на статью прямо в тексте (не гиперссылкой)</label>
<label>Футер (текст в конце каждого поста; @username станет ссылкой; off — убрать)</label><textarea id="footer"></textarea>
<div style="margin-top:14px"><button id="save">💾 Сохранить</button></div></div>
<div class="card"><h2>Статистика API</h2><pre id="stats">…</pre></div>
</div>
<div class="wrap" id="login"><div class="card"><h2>Вход</h1></h2><label>Пароль панели (web.password)</label><input id="pw" type="password"><div style="margin-top:12px"><button id="loginBtn">Войти</button></div><div class="msg" id="lmsg"></div></div></div>
<script>
const $=id=>document.getElementById(id);let token=localStorage.getItem('ndb_token')||'';
function say(t,ok){const m=$('msg');m.textContent=t;m.className='msg '+(ok?'ok':'err');setTimeout(()=>m.className='msg',6000)}
async function api(p,body){const r=await fetch(p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Auth':token},body:body?JSON.stringify(body):undefined});if(r.status===401){document.getElementById('app').hidden=true;$('login').style.display='';throw new Error('auth')}return r.json()}
async function load(){try{const s=await api('/api/state');$('app').hidden=false;$('login').style.display='none';$('host').textContent=s.host;
$('status').innerHTML='<span class="stat">⏱ интервал: '+esc(s.interval)+'</span><span class="stat">🔗 ссылка в тексте: '+(s.inline_url?'вкл':'выкл')+'</span><span class="stat">📝 режим: '+esc(s.mode)+'</span><span class="stat">🎯 целей: '+s.targets+'</span>';
$('mode').value=s.mode;$('ivMin').value=s.ivMin;$('ivMax').value=s.ivMax;$('inlineUrl').checked=!!s.inline_url;$('footer').value=s.footer;
$('stats').textContent=s.report;}catch(e){if(e.message!=='auth')say('Ошибка загрузки: '+e.message)}}
$('loginBtn').onclick=async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('pw').value})});const j=await r.json();if(j.token){token=j.token;localStorage.setItem('ndb_token',token);load()}else{$('lmsg').textContent='Неверный пароль';$('lmsg').className='msg err'}};
$('pw').addEventListener('keydown',e=>{if(e.key==='Enter')$('loginBtn').click()});
$('save').onclick=async()=>{try{const j=await api('/api/settings',{mode:$('mode').value,ivMin:Number($('ivMin').value),ivMax:Number($('ivMax').value),inline_url:$('inlineUrl').checked,footer_text:$('footer').value});if(j.ok){say(j.restart?'Сохранено. Интервал применится после перезапуска сервиса.':'Сохранено и применено.',true);load()}else say(j.error||'Ошибка',false)}catch(e){}};
$('runNow').onclick=async()=>{say('Собираю дайджест…',true);try{const j=await api('/api/run',{});say(j.ok?'Отправлено: '+(j.sent||0) сообщений.':'Ошибка: '+(j.error||''),!!j.ok)}catch(e){}};
$('refresh').onclick=load;load();
</script></body></html>`}

function createWebServer(ctx){
 const {config,persist,runNow,report}=ctx;
 const sessions=new Map();
 const password=String(config.web?.password||'');
 function auth(req){const t=(req.headers['x-auth']||'');return sessions.has(t)}
 const server=http.createServer(async(req,res)=>{
 const send=(code,body,type)=>{res.writeHead(code,{'Content-Type':type||'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(body)};
 try{
 if(req.method==='GET'&&(req.url==='/'||req.url.startsWith('/?'))){return send(200,page(config.web?.domain||'localhost',config.web?.port||3000),'text/html; charset=utf-8')}
 if(req.url==='/api/login'&&req.method==='POST'){const b=await body(req);if(String(b.password||'')===password&&password){const t=crypto.randomBytes(24).toString('hex');sessions.set(t,Date.now()+24*3600e3);return send(200,JSON.stringify({token:t}))}return send(401,JSON.stringify({error:'Неверный пароль'}))}
 if(!auth(req))return send(401,JSON.stringify({error:'auth'}));
 if(req.url==='/api/state'&&req.method==='GET'){const s=config.schedule||{};const d=config.digest||{};const mn=Number(s.interval_min_minutes||0),mx=Number(s.interval_max_minutes||0);
 return send(200,JSON.stringify({interval:mn>0?`${mn}-${mx||mn} мин (случайно)`:`cron: ${s.cron||'—'}`,inline_url:d.inline_url===true,mode:d.mode||'digest',footer:config.telegram?.footer_text||'',ivMin:mn||45,ivMax:mx||mn||45,targets:(config.telegram?.targets||[]).filter(t=>t.enabled!==false).length,host:config.web?.domain||'localhost',report:plainReport()}))}
 if(req.url==='/api/settings'&&req.method==='POST'){const b=await body(req);
 if(b.mode==='single'||b.mode==='digest'){config.digest=config.digest||{};config.digest.mode=b.mode}
 if(b.ivMin>=1&&b.ivMax>=b.ivMin&&b.ivMax<=1440){config.schedule=config.schedule||{};config.schedule.interval_min_minutes=Math.round(b.ivMin);config.schedule.interval_max_minutes=Math.round(b.ivMax)}
 if(typeof b.inline_url==='boolean'){config.digest=config.digest||{};config.digest.inline_url=b.inline_url}
 if(typeof b.footer_text==='string'&&b.footer_text.length<=300){if(/^off$/i.test(b.footer_text.trim()))delete config.telegram.footer_text;else config.telegram.footer_text=b.footer_text}
 const changedInterval=!!(b.ivMin&&b.ivMax);persist();return send(200,JSON.stringify({ok:true,restart:changedInterval}))}
 if(req.url==='/api/run'&&req.method==='POST'){try{const n=await runNow();return send(200,JSON.stringify({ok:true,sent:n}))}catch(e){return send(200,JSON.stringify({ok:false,error:e.message}))}}
 if(req.url==='/api/stats'&&req.method==='GET')return send(200,JSON.stringify({report:plainReport()}));
 send(404,JSON.stringify({error:'not found'}));
 }catch(e){send(500,JSON.stringify({error:e.message}))}
 });
 function plainReport(){try{const html=report();return html.replace(/<[^>]+>/g,'').replace(/\n{3,}/g,'\n\n').trim()}catch(e){return 'Статистика недоступна: '+e.message}}
 return server;
}
function body(req){return new Promise((ok,err)=>{let d='';req.on('data',c=>{d+=c;if(d.length>64e3)req.destroy()});req.on('end',()=>{try{ok(JSON.parse(d||'{}'))}catch(e){ok({})}});req.on('error',err)})}
module.exports={createWebServer};
