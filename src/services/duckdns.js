const https=require('https');
const dns=require('dns').promises;
const net=require('net');
const fs=require('fs');
function normalizeDomain(value) {
  const domain=String(value||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
  const full=domain.endsWith('.duckdns.org')?domain:domain+'.duckdns.org';
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.duckdns\.org$/.test(full))throw new Error('Нужен один поддомен DuckDNS, например mynews.duckdns.org');
  return full;
}
async function updateDuckDns(settings, transport=https) {
  const domain=normalizeDomain(settings.domain);
  if(!settings.token||/^(YOUR_|CHANGE_ME)/.test(settings.token))throw new Error('Не задан токен DuckDNS');
  const url=new URL('https://www.duckdns.org/update');
  url.search=new URLSearchParams({domains:domain.replace(/\.duckdns\.org$/,''),token:settings.token,ip:'',verbose:'true'}).toString();
  return new Promise((resolve,reject)=>{
    const request=transport.get(url,{family:4},response=>{
      let data='';response.setEncoding('utf8');
      response.on('data',chunk=>{data+=chunk;if(data.length>4096)request.destroy();});
      response.on('error',()=>reject(new Error('DuckDNS: ошибка чтения ответа')));
      response.on('end',()=>{
        const lines=data.trim().split(/\r?\n/);
        if(response.statusCode!==200||lines[0]!=='OK')return reject(new Error('DuckDNS отклонил обновление. Проверь токен и поддомен в аккаунте.'));
        resolve({domain,ipv4:net.isIPv4(lines[1])?lines[1]:null});
      });
    });
    request.setTimeout(15000,()=>request.destroy());
    request.on('error',()=>reject(new Error('DuckDNS: сеть или таймаут. Токен в журнал не записан.')));
  });
}
function startDuckDns(config) {
  let stopped=false,timer;
  const tick=async()=>{
    const settings=config.web?.duckdns;
    if(!settings?.enabled||stopped)return;
    try{await updateDuckDns(settings);console.log('[DUCKDNS] DNS обновлён');}catch(error){console.error('[DUCKDNS]',error.message);}
    if(!stopped)timer=setTimeout(tick,Math.max(1,Number(settings.interval_minutes)||5)*60000);
  };
  tick();return()=>{stopped=true;clearTimeout(timer);};
}
async function waitForDns(settings) {
  const expected=await updateDuckDns(settings);
  if(!expected.ipv4)throw new Error('DuckDNS не сообщил IPv4 сервера. Проверь DNS вручную.');
  for(let attempt=0;attempt<24;attempt++) {
    let timeout;
    try { const ips=await Promise.race([dns.resolve4(expected.domain),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('dns')),3000);})]);if(ips.includes(expected.ipv4))return; } catch {} finally {clearTimeout(timeout);}
    if(attempt<23)await new Promise(resolve=>setTimeout(resolve,5000));
  }
  throw new Error('DNS DuckDNS ещё не обновился. Подожди несколько минут и повтори установку.');
}
if(require.main===module) {
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  waitForDns(config.web.duckdns).then(()=>console.log('DuckDNS готов для выпуска SSL')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={normalizeDomain,updateDuckDns,startDuckDns,waitForDns};
