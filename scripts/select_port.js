const net=require('net');
const fs=require('fs');
async function freePort(host='127.0.0.1') {
  return new Promise((resolve,reject)=>{
    const server=net.createServer();server.once('error',reject);
    server.listen(0,host,()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});
  });
}
async function selectPort(file) {
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(config.web?.enabled&&config.web.random_port!==false) {
    config.web.port=await freePort(config.web.host||'127.0.0.1');
    const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);fs.chmodSync(file,0o600);
  }
  return config.web?.port;
}
if(require.main===module)selectPort(process.argv[2]).then(port=>console.log(`Внутренний порт панели: ${port}`)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={freePort,selectPort};
