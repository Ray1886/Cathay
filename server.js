const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/assets/lounge-hero.png': ['assets/lounge-hero.png', 'image/png'],
  '/assets/lounge-scenes.png': ['assets/lounge-scenes.png', 'image/png']
};
const INSTRUCTIONS = [
  '你是高端航空貴賓室的智能行程助理，以自然、簡潔的繁體中文回答。',
  '根據提供的航班、登機口、時間與現有行程回答；計算時間時要準確。',
  '這是概念原型，沒有真實航班、空位或預約系統。不可聲稱查到了即時資訊、完成了真實預約或已實際更改航班。',
  '如果旅客要求調整，提出具體可行的時段與取捨；只有介面中的確認或編輯操作會更新原型行程。',
  '若資訊不足，說明需要哪些資訊。一般回覆控制在兩至四句，避免制式套話。'
].join('\n');

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter(item => item && (item.role === 'user' || item.role === 'agent') && typeof item.text === 'string').slice(-8)
    .map(item => ({ role: item.role === 'agent' ? 'assistant' : 'user', content: item.text.slice(0, 1200) }));
}

function buildResponsePayload({ message, history, context }, model = 'deepseek-flash') {
  const itinerary = Array.isArray(context?.activities) ? context.activities.slice(0, 12).map(item => ({
    activity: String(item.label || '').slice(0, 40),
    start: String(item.start || '').slice(0, 8),
    end: String(item.end || '').slice(0, 8),
    status: String(item.status || '').slice(0, 20),
    venue: String(item.venue || '').slice(0, 80)
  })) : [];
  const flight = { number: 'CX251', destination: '倫敦希斯路', boarding: '19:20', gate: String(context?.gate || '25').slice(0, 8), loungeWindow: '17:30–19:15' };
  return {
    model,
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: '目前行程資料：' + JSON.stringify({ flight, itinerary }) },
      ...cleanHistory(history),
      { role: 'user', content: message }
    ],
    thinking: { type: 'enabled' },
    reasoning_effort: 'low',
    stream: false,
    max_tokens: 4096
  };
}

function extractOutputText(response) {
  return typeof response?.choices?.[0]?.message?.content === 'string'
    ? response.choices[0].message.content.trim() : '';
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16000) {
      const error = new Error('Request too large');
      error.status = 413;
      throw error;
    }
  }
  try { return JSON.parse(body); }
  catch (_) {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function createAppServer({ apiKey = process.env.DEEPSEEK_API_KEY, model = process.env.DEEPSEEK_MODEL || 'deepseek-flash', fetchImpl = fetch } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/status' && request.method === 'GET') {
      sendJson(response, 200, { mode: apiKey ? 'live' : 'demo', provider: 'deepseek', model: apiKey ? model : null });
      return;
    }
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      if (!apiKey) { sendJson(response, 503, { error: 'AI_NOT_CONFIGURED' }); return; }
      try {
        const body = await readJson(request);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message || message.length > 2000) { sendJson(response, 400, { error: 'INVALID_MESSAGE' }); return; }
        const payload = buildResponsePayload({ message, history: body.history, context: body.context }, model);
        const upstream = await fetchImpl(DEEPSEEK_CHAT_URL, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000)
        });
        if (!upstream.ok) {
          console.error('DeepSeek response failed:', upstream.status);
          const error = upstream.status === 401 ? 'AI_AUTH_FAILED'
            : upstream.status === 402 ? 'AI_BALANCE_LOW'
            : upstream.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE';
          sendJson(response, 502, { error });
          return;
        }
        const answer = extractOutputText(await upstream.json());
        if (!answer) { sendJson(response, 502, { error: 'EMPTY_AI_RESPONSE' }); return; }
        sendJson(response, 200, { reply: answer });
      } catch (error) {
        if (error.status) sendJson(response, error.status, { error: error.message });
        else { console.error('AI request failed:', error.name); sendJson(response, 502, { error: 'AI_UNAVAILABLE' }); }
      }
      return;
    }
    if (request.method !== 'GET' || !FILES[url.pathname]) {
      sendJson(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    const [file, contentType] = FILES[url.pathname];
    try {
      const contents = await fs.readFile(path.join(ROOT, file));
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(contents);
    } catch (_) {
      sendJson(response, 404, { error: 'NOT_FOUND' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  createAppServer().listen(port, '127.0.0.1', () => {
    const pageUrl = 'http://127.0.0.1:' + port + '/';
    console.log('貴賓室原型已啟動：' + pageUrl);
    console.log(process.env.DEEPSEEK_API_KEY ? '模式：DeepSeek AI' : '模式：演示（未設定 DEEPSEEK_API_KEY）');
    console.log('請保持此終端視窗開啟；關閉視窗後，本機頁面就無法使用。');
    if (process.env.OPEN_BROWSER === '1' && process.platform === 'darwin') {
      const browser = spawn('open', [pageUrl], { stdio: 'ignore' });
      browser.on('error', () => console.log('無法自動打開瀏覽器，請手動前往：' + pageUrl));
      browser.unref();
    }
  });
}

module.exports = { createAppServer, buildResponsePayload, extractOutputText, cleanHistory };
