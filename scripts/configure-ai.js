'use strict';
// The caller supplies a key through a hidden terminal prompt. Never persist or log it.
async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey?.trim()) throw new Error('未提供密钥，请使用终端隐藏输入。');
  const response = await fetch('http://127.0.0.1:8765/api/configure', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apiKey}), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('本地 AI 配置失败，HTTP ' + response.status);
  console.log('DeepSeek 已配置到主服务内存；密钥未保存。请刷新主界面。');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
