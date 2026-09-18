try{
const fs=require('fs');const SP=String.fromCharCode(32);const f='deploy/install.sh';let s=fs.readFileSync(f,'utf8');
const pairs=[
 ['exit'+1,'exit'+SP+1],
 ['-ne'+0,'-ne'+SP+0],
 ['/dev/null'+2+'&1','/dev/null'+SP+2+'&1'],
 ['Node.js'+18.18+'+','Node.js'+SP+18.18+'+'],
 ['Node.js >='+18.18,'Node.js >='+SP+18.18],
 ['--max-time'+10,'--max-time'+SP+10],
 ['listen'+80+';','listen'+SP+80+';'],
 ['порт'+80,'порт'+SP+80],
 ['слушает'+127,'слушает'+SP+127],
 [' на'+0.0,' на'+SP+0.0],
 ['||'+3000,'||'+SP+3000],
 ['null,'+2+')','null,'+SP+2+')'],
 ['org'+2+'>','org'+SP+2+'>'],
 ['"'+2+'>/dev/null','"'+SP+2+'>/dev/null'],
 ['>= '+18.18,'>='+SP+18.18]
];
let n=0;
for(const[a,b]of pairs){while(s.includes(a)){s=s.split(a).join(b);n++}}
fs.writeFileSync(f,s);
const check=fs.readFileSync(f,'utf8');
console.log('replacements:',n,'| still broken:',check.includes('exit'+1)||check.includes('ne'+0)||check.includes('null'+2));
console.log('line12:',check.split(String.fromCharCode(10))[11]);
console.log('line17:',check.split(String.fromCharCode(10))[16]);
console.log('line55:',check.split(String.fromCharCode(10))[54]);
}catch(e){console.log('ERR',e.stack)}
