'use strict';
const path=require('node:path'),fs=require('node:fs'),net=require('node:net');
const {spawn}=require('node:child_process'),readline=require('node:readline'),{Writable}=require('node:stream');
const root=path.resolve(__dirname,'..');
async function hiddenKey(){
  if(!process.stdin.isTTY)throw Error('请在交互终端输入密钥，或通过 DEEPSEEK_API_KEY 环境变量提供。');
  const output=new Writable({write(_chunk,_encoding,done){done();}});
  const rl=readline.createInterface({input:process.stdin,output,terminal:true,historySize:0});
  process.stdout.write('DeepSeek API key（隐藏输入，不保存）: ');
  return new Promise(resolve=>{rl.once('SIGINT',()=>{rl.close();process.stdout.write('\n');resolve(null);});rl.question('',answer=>{rl.close();process.stdout.write('\n');resolve(answer.trim());});});
}
function openBrowser(url){
  let command,args;
  const wsl=process.platform==='linux'&&(()=>{try{return /microsoft/i.test(fs.readFileSync('/proc/sys/kernel/osrelease','utf8'));}catch{return false;}})();
  if(process.platform==='win32'||wsl){command='rundll32.exe';args=['url.dll,FileProtocolHandler',url];}
  else if(process.platform==='darwin'){command='open';args=[url];}
  else{command='xdg-open';args=[url];}
  const browser=spawn(command,args,{stdio:'ignore',windowsHide:true,detached:true});browser.once('error',()=>console.log('请在浏览器打开 '+url));browser.unref();
}
async function main(){
  if(process.argv.includes('--help')){console.log('npm run start:open  启动并打开浏览器\nnpm run start:ai    隐藏输入密钥，启动 DeepSeek 版本');return;}
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==24||minor<15)throw Error('请使用 Node.js 24.15.0 或以上的 24.x。启动器不会安装或升级软件。');
  const port=Number(process.env.PORT||8765);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT 必须为 1–65535 的整数。');
  await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error('端口 '+port+' 已被占用。可先打开 http://127.0.0.1:'+port+'/ 或停止旧服务。')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
  let apiKey=process.env.DEEPSEEK_API_KEY;
  if(process.argv.includes('--ai')&&!apiKey){apiKey=await hiddenKey();if(apiKey===null){process.exitCode=130;return;}if(!apiKey)throw Error('未输入密钥，已取消。也可用 npm run start:open 启动演示。');}
  const url='http://127.0.0.1:'+port+'/',env={...process.env,OPEN_BROWSER:'0'};
  if(apiKey)env.DEEPSEEK_API_KEY=apiKey;
  const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env,stdio:'inherit',windowsHide:true});
  delete env.DEEPSEEK_API_KEY;apiKey=undefined;
  child.once('error',error=>{console.error('启动失败：'+error.message);process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code||0;});
  process.once('SIGINT',()=>child.kill('SIGINT'));process.once('SIGTERM',()=>child.kill('SIGTERM'));
  for(let attempt=0;attempt<20;attempt++){
    if(child.exitCode!==null)return;
    try{const response=await fetch(url+'api/status',{signal:AbortSignal.timeout(500)});if(response.ok){openBrowser(url);return;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  console.log('服务仍在启动，请稍后打开 '+url);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
