const fs = require('fs');

function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function saveJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normalizeText(value = '') { return String(value).toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function tokenize(value) { return new Set(normalizeText(value).split(' ').filter(Boolean)); }
function jaccard(a,b) { const A=tokenize(a), B=tokenize(b); if(!A.size||!B.size) return 0; let i=0; for(const x of A) if(B.has(x)) i++; return i/(A.size+B.size-i); }
function dedupeBySimilarity(items, threshold=.86) { const kept=[]; for(const item of items){ const s=`${item.title} ${item.description||''}`; if(kept.some(k=>jaccard(s,`${k.title} ${k.description||''}`)>=threshold)) continue; kept.push(item);} return kept; }
function escapeHtml(value='') { return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function validHttpUrl(url) { try { const u=new URL(url); return ['http:','https:'].includes(u.protocol); } catch { return false; } }
function getByPath(obj,p) { return String(p||'').split('.').filter(Boolean).reduce((a,k)=>a==null?undefined:a[k],obj); }
function clampText(value,max){ const s=String(value||'').trim(); return s.length<=max?s:`${s.slice(0,Math.max(0,max-1)).trimEnd()}…`; }
module.exports={loadJson,saveJson,sleep,normalizeText,jaccard,dedupeBySimilarity,escapeHtml,validHttpUrl,getByPath,clampText};
