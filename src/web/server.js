const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {maskSecrets,preserveSecrets,merge,validate}=require('../services/configuration');
function createWebServer(ctx) {
  const {config,apply,status,runNow,report}=ctx;
  const root=ctx.root||path.resolve(__dirname,'../..');
  const publicDir=path.join(root,'public/panel');
  const sessions=new Map(),attempts=new Map();
  const passwordHash=value=>crypto.createHash('sha256').update(String(value||'')).digest();
  function cookie(req){return /(?:^|;\s*)news_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];}
  function sameOrigin(req){if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}}
  function settings(){const secrets=[];return {config:maskSecrets(config,secrets),secrets,revision:crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'),status:status(),updatedAt:new Date().toISOString()};}
  return http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"};
    const send=(code,data,type='application/json; charset=utf-8',extra={})=>{res.writeHead(code,{...headers,'Content-Type':type,...extra});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&['/','/panel.js','/style.css'].includes(url.pathname)) {
        const file={'/':'index.html','/panel.js':'panel.js','/style.css':'style.css'}[url.pathname];
        const type=file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
        return send(200,fs.readFileSync(path.join(publicDir,file)),type);
      }
      if(req.method==='POST'&&!sameOrigin(req))return send(403,{error:'Запрос с другого сайта запрещён'});
      if(url.pathname==='/api/login'&&req.method==='POST') {
        const ip=req.socket.remoteAddress||'unknown';
        const now=Date.now();
        for(const [key,value]of attempts)if(value.until<now)attempts.delete(key);
        const attempt=attempts.get(ip)||{count:0,until:now+10*60000};
        if(attempt.count>=10)return send(429,{error:'Слишком много попыток. Повтори через 10 минут.'});
        const data=await body(req);
        if(!config.web.password||!crypto.timingSafeEqual(passwordHash(data.password),passwordHash(config.web.password))) {
          if(attempts.size<1000||attempts.has(ip))attempts.set(ip,{...attempt,count:attempt.count+1});
          return send(401,{error:'Неверный пароль'});
        }
        attempts.delete(ip);
        for(const [key,value]of sessions)if(value.until<now)sessions.delete(key);
        if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
        const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
        sessions.set(token,{until:now+24*3600000,csrf,password:passwordHash(config.web.password).toString('hex')});
        const secure=req.headers['x-forwarded-proto']==='https'||req.socket.encrypted;
        return send(200,{ok:true,csrf},undefined,{'Set-Cookie':`news_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure?'; Secure':''}`});
      }
      const token=cookie(req),session=sessions.get(token);
      if(!session||session.until<Date.now()||session.password!==passwordHash(config.web.password).toString('hex')){if(token)sessions.delete(token);return send(401,{error:'Войди в панель'});}
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)return send(403,{error:'Обнови страницу и повтори действие'});
      if(url.pathname==='/api/logout'&&req.method==='POST'){sessions.delete(token);return send(200,{ok:true},undefined,{'Set-Cookie':'news_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
      if(url.pathname==='/api/config'&&req.method==='GET')return send(200,{...settings(),csrf:session.csrf});
      if(url.pathname==='/api/config'&&req.method==='POST') {
        const data=await body(req);
        if(!data.config||typeof data.config!=='object'||Array.isArray(data.config))return send(400,{error:'Некорректная конфигурация'});
        if(data.revision!==crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'))return send(409,{error:'Настройки изменены в другой вкладке или через Telegram. Обнови страницу перед сохранением.'});
        const next=merge(config,preserveSecrets(config,data.config));
        // Serving interface remains available: changing bind/domain is an installer operation.
        next.web={...next.web,enabled:true,host:config.web.host,port:config.web.port,domain:config.web.domain,auto_ssl:config.web.auto_ssl,random_port:config.web.random_port};
        if(next.web.duckdns&&config.web.duckdns)next.web.duckdns.domain=config.web.duckdns.domain;
        next.setup={completed:data.activate===true};
        const errors=validate(next,data.activate===true);
        if(errors.length)return send(400,{error:'Проверь поля настроек',errors});
        const result=await apply(next);
        return send(200,{ok:true,status:result,message:data.activate?'Настройки сохранены и применены.':'Черновик сохранён. Автопубликация выключена.'});
      }
      if(url.pathname==='/api/run'&&req.method==='POST')return send(200,{ok:true,sent:await runNow()});
      if(url.pathname==='/api/state'&&req.method==='GET') {
        let updates={};try{updates=JSON.parse(fs.readFileSync(path.join(root,'.updates/status.json'),'utf8'));}catch{}
        return send(200,{...status(),report:report().replace(/<[^>]+>/g,''),updates,targets:config.telegram.targets.filter(t=>t.enabled!==false).length});
      }
      send(404,{error:'Страница не найдена'});
    }catch(error){send(error.status||400,{error:error.message||'Ошибка запроса'});}
  });
}
function body(req){return new Promise((resolve,reject)=>{let text='';req.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>256*1024){const error=new Error('Слишком большой запрос');error.status=413;reject(error);req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(text||'{}'));}catch{reject(new Error('Некорректный JSON'));}});req.on('error',reject);});}
module.exports={createWebServer};
