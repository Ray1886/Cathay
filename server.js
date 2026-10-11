const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { applyProposalToDraft, validateItinerary, SERVICES, LOCATIONS, DEMO_AVAILABILITY } = require('./itinerary.js');
const {handleRecovery,stateFromContext,policy}=require('./recovery/integration');
const {signature}=require('./recovery/flight-state');
const {createSqliteRecoveryAdapter}=require('./recovery/sqlite-adapter');
const {epoch}=require('./recovery/time');
const {randomUUID}=require('node:crypto');

const ROOT = __dirname;
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/itinerary.js': ['itinerary.js', 'text/javascript; charset=utf-8'],
  '/travel-time.js': ['travel-time.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/assets/lounge-hero.png': ['assets/lounge-hero.png', 'image/png'],
  '/assets/lounge-scenes.png': ['assets/lounge-scenes.png', 'image/png']
};
const INSTRUCTIONS = [
  '你是高端航空貴賓室的智能行程助理，以自然、簡潔的繁體中文回答。',
  '根據提供的航班、登機口、時間與現有行程回答；計算時間時要準確。',
  '這是概念原型，沒有真實航班、空位或預約系統。不可聲稱查到了即時資訊、完成了真實預約或已實際更改航班。',
  '當旅客要求新增、取消、改時段或重新安排行程時，使用 propose_itinerary_change 工具產生明確操作。只修改旅客提及或為避免衝突必須調整的項目，保留其他活動。',
  '工具只是提出修改草案；旅客點擊「確認並保存」前不可聲稱行程已更改。不可聲稱真實預約已取消或確認。',
  '若要求不可行，請解釋時間衝突與可行替代；一般詢問只需對話，不呼叫工具。',
  '若資訊不足，說明需要哪些資訊。一般回覆控制在兩至四句，避免制式套話。'
].join('\n');
const PROPOSAL_TOOL = {
  type: 'function',
  function: {
    name: 'propose_itinerary_change',
    description: 'Propose add, update, or remove operations for the local itinerary. The client previews and validates the draft before any change is applied.',
    parameters: {
      type: 'object',
      properties: {
        explanation: { type: 'string', description: 'Short Traditional Chinese explanation of the proposed changes.' },
        operations: { type: 'array', items: { type: 'object', properties: {
          op: { type: 'string', enum: ['add','update','remove'] },
          id: { type: 'integer', description: 'Existing activity id for update or remove.' },
          type: { type: 'string', enum: Object.keys(SERVICES) },
          locationId: { type: 'string', enum: Object.keys(LOCATIONS), description: 'Selected Cathay lounge for add or update.' },
          start: { type: 'string', description: 'HH:MM start time for add or update.' },
          end: { type: 'string', description: 'HH:MM end time for add or update.' },
          startAt: { type: 'string', description: 'Full ISO timestamp with date and timezone, required for cross-midnight changes.' },
          endAt: { type: 'string', description: 'Full ISO timestamp with date and timezone, required for cross-midnight changes.' }
        }, required: ['op'] } },
        warnings: { type: 'array', items: { type: 'string' } }
      },
      required: ['explanation','operations']
    }
  }
};

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter(item => item && (item.role === 'user' || item.role === 'agent') && typeof item.text === 'string').slice(-8)
    .map(item => ({ role: item.role === 'agent' ? 'assistant' : 'user', content: item.text.slice(0, 1200) }));
}

function buildResponsePayload({ message, history, context }, model = 'deepseek-flash') {
  const itinerary = Array.isArray(context?.activities) ? context.activities.slice(0, 12).map(item => ({
    id: Number.isInteger(item.id) ? item.id : null,
    type: String(item.type || '').slice(0, 20),
    activity: String(item.label || '').slice(0, 40),
    start: String(item.start || '').slice(0, 8),
    end: String(item.end || '').slice(0, 8),
    startAt: item.startAt ? String(item.startAt).slice(0, 40) : undefined,
    endAt: item.endAt ? String(item.endAt).slice(0, 40) : undefined,
    status: String(item.status || '').slice(0, 20),
    locationId: String(item.locationId || '').slice(0, 20),
    venue: String(item.venue || '').slice(0, 80)
  })) : [];
  const flight = {
    number: String(context?.flightNumber || 'CX251').slice(0, 16),
    destination: '倫敦希斯路',
    boardingTime: String(context?.boardingTime || '19:20').slice(0, 8),
    gate: String(context?.gate || '25').slice(0, 8),
    loungeWindow: String(context?.windowStart || '17:30')+'–'+String(context?.windowEnd || '19:15'),
    boardingBufferMinutes: Number.isInteger(context?.boardingBuffer)?context.boardingBuffer:10,
    walkingMinutes:context?.walkingMinutes??null,
    journey:context?.journey?{boardingAt:context.journey.boardingAt,boardingCutoffAt:context.journey.boardingCutoffAt,expectedLoungeArrivalAt:context.journey.expectedLoungeArrivalAt,estimatedDepartureAt:context.journey.estimatedDepartureAt}:null
  };
  const services=Object.entries(SERVICES).map(([type,service])=>({type,label:service.label,durationMinutes:service.duration,defaultLocationId:service.locationId,availableLocations:(service.locations||[]).map(locationId=>({locationId,venue:LOCATIONS[locationId].name,area:LOCATIONS[locationId].areas[type],address:LOCATIONS[locationId].address})),reservationRequired:Boolean(service.reservationRequired)}));
  return {
    model,
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: '目前行程與限制：' + JSON.stringify({ flight, itinerary, services }) },
      ...cleanHistory(history),
      { role: 'user', content: message }
    ],
    thinking: { type: 'enabled' },
    reasoning_effort: 'low',
    tools: [PROPOSAL_TOOL],
    tool_choice: 'auto',
    stream: false,
    max_tokens: 4096
  };
}

function extractOutputText(response) {
  return typeof response?.choices?.[0]?.message?.content === 'string'
    ? response.choices[0].message.content.trim() : '';
}

function extractProposal(response,context){
  const calls=response?.choices?.[0]?.message?.tool_calls;
  const call=Array.isArray(calls)?calls.find(item=>item?.function?.name==='propose_itinerary_change'):null;
  if(!call)return null;
  try{
    const parsed=JSON.parse(call.function.arguments);
    if(typeof parsed.explanation!=='string'||!parsed.explanation.trim()||!Array.isArray(parsed.operations))throw new Error('提案內容不完整。');
    const operations=parsed.operations.slice(0,13).map(operation=>({
      op:operation.op,id:operation.id,type:operation.type,locationId:operation.locationId,start:operation.start,end:operation.end,startAt:operation.startAt,endAt:operation.endAt
    }));
    const draft=applyProposalToDraft(context?.activities||[],operations,context);
    const checked=validateItinerary(draft,{...context,originalActivities:context?.activities||[]});
    if(!checked.valid)return {error:checked.errors.join(' ')};
    return {type:'itinerary_proposal',explanation:parsed.explanation.trim().slice(0,800),operations,
      warnings:[...new Set([...(Array.isArray(parsed.warnings)?parsed.warnings.filter(value=>typeof value==='string').map(value=>value.slice(0,200)):[]),...checked.warnings])].slice(0,8)};
  }catch(error){return {error:error.message||'提案格式無效。'}}
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

function createAppServer({ apiKey = process.env.DEEPSEEK_API_KEY, model = process.env.DEEPSEEK_MODEL || 'deepseek-flash', fetchImpl = fetch, reservationService } = {}) {
  const previews=new Map();
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if(url.pathname==='/api/configure'||url.pathname.startsWith('/api/recovery')) {
      const socket=request.socket,host=request.headers.host;
      const origin=request.headers.origin;
      const allowedHost=['127.0.0.1:'+socket?.localPort,'localhost:'+socket?.localPort,'[::1]:'+socket?.localPort];
      if(!socket||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(socket.remoteAddress)||!allowedHost.includes(host)||(origin&&origin!=='http://'+host)) {sendJson(response,403,{error:'LOCAL_ONLY'});return;}
      if(request.method!=='POST'){sendJson(response,405,{error:'METHOD_NOT_ALLOWED'});return;}
      try {
        const body=await readJson(request);
        if(url.pathname==='/api/configure') {
          if(typeof body?.apiKey!=='string'||!body.apiKey.trim()||body.apiKey.length>512){sendJson(response,400,{error:'INVALID_KEY'});return;}
          apiKey=body.apiKey.trim();sendJson(response,200,{configured:true});return;
        }
        if(url.pathname==='/api/recovery') {
          const recovered=await handleRecovery(body,reservationService);
          const previewId=randomUUID();
          for(const [id,value] of previews)if(value.expiresAt<Date.now())previews.delete(id);
          if(previews.size>=100)previews.delete(previews.keys().next().value);
          previews.set(previewId,{response:recovered,expiresAt:Date.now()+10*60000});
          sendJson(response,200,{...recovered,previewId});return;
        }
        const cached=previews.get(body.previewId);
        if(!cached||cached.expiresAt<Date.now()){sendJson(response,409,{error:'STALE_RECOVERY'});return;}
        if(url.pathname==='/api/recovery/confirm') {
          const state=stateFromContext(body.context);
          if(signature(state)!==signature(cached.response.state)){sendJson(response,409,{error:'STALE_RECOVERY'});return;}
          if(cached.confirmed){sendJson(response,200,cached.confirmed);return;}
          const result=cached.response.result;
          if(result.type!=='itinerary_proposal'){sendJson(response,400,{error:'NO_RECOVERY_PROPOSAL'});return;}
          const checked=validateItinerary(result.draft,{...policy(state),originalActivities:state.currentItinerary});
          if(!checked.valid){sendJson(response,409,{error:'INVALID_RECOVERY',details:checked.errors});return;}
          if(reservationService) {
            const adapter=createSqliteRecoveryAdapter(reservationService,{activities:state.currentItinerary});
            for(const next of result.draft) {
              const old=state.currentItinerary.find(a=>a.id===next.id);
              if(next.type!=='gate'&&SERVICES[next.type].reservationRequired&&old&&(epoch(next.startAt)!==epoch(old.startAt)||epoch(next.endAt)!==epoch(old.endAt))) {
                await adapter.listAlternativeSlots({loungeServiceId:old.loungeServiceId||old.type,locationId:next.locationId,startAt:next.startAt,endAt:next.endAt});
                const available=await adapter.checkSlotAvailability(old.loungeServiceId||old.type,next.startAt,next.endAt);
                if(!available.available){sendJson(response,409,{error:'RECOVERY_SLOT_CHANGED'});return;}
              }
            }
          }
          cached.confirmed={draft:result.draft,warnings:[...new Set([...result.warnings,...checked.warnings])],bookingCommitted:false};
          sendJson(response,200,cached.confirmed);return;
        }
        if(url.pathname==='/api/recovery/explain') {
          if(!apiKey){sendJson(response,503,{error:'AI_NOT_CONFIGURED'});return;}
          const {event,impact,result}=cached.response;
          const upstream=await fetchImpl(DEEPSEEK_CHAT_URL,{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:'以自然繁體中文，兩至四句解釋提供的恢復引擎結果。航班與步行為模擬，不是即時資料。不可編造空位、聲稱完成預約，或把起飛延誤當成登機延誤。草案必須由旅客確認。不要修改提供的約束或草案。'},{role:'user',content:JSON.stringify({event,constraints:impact.constraints,result})}],stream:false,max_tokens:1024,thinking:{type:'disabled'}}),signal:AbortSignal.timeout(60000)});
          if(!upstream.ok){sendJson(response,502,{error:({401:'AI_AUTH_FAILED',402:'AI_BALANCE_LOW',429:'AI_RATE_LIMITED'})[upstream.status]||'AI_UNAVAILABLE'});return;}
          const reply=extractOutputText(await upstream.json());
          sendJson(response,reply?200:502,reply?{reply}:{error:'EMPTY_AI_RESPONSE'});return;
        }
        sendJson(response,404,{error:'NOT_FOUND'});
      } catch(error){sendJson(response,error.status||(url.pathname==='/api/recovery/explain'?502:400),{error:error.status?error.message:url.pathname==='/api/recovery/explain'?'AI_UNAVAILABLE':'INVALID_RECOVERY_REQUEST'});}
      return;
    }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      sendJson(response, 200, { mode: apiKey ? 'live' : 'demo', provider: 'deepseek', model: apiKey ? model : null });
      return;
    }
    if (url.pathname === '/api/availability' && request.method === 'GET') {
      sendJson(response, 200, DEMO_AVAILABILITY);
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
        const completion = await upstream.json();
        const proposal=extractProposal(completion,body.context);
        if(proposal){
          if(proposal.error)sendJson(response,200,{type:'chat',reply:'目前無法安全套用這項修改：'+proposal.error+' 請調整時間或需求後再試。'});
          else sendJson(response,200,proposal);
          return;
        }
        const answer = extractOutputText(completion);
        if (!answer) { sendJson(response, 502, { error: 'EMPTY_AI_RESPONSE' }); return; }
        sendJson(response, 200, { type:'chat',reply: answer });
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
  const {openDatabase,DEFAULT_DATABASE_PATH}=require('./backend/db');
  const {seedDatabase}=require('./database/seed');
  const {createReservationService}=require('./backend/reservation-service');
  const db=openDatabase({filename:DEFAULT_DATABASE_PATH});
  seedDatabase(db,{date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())});
  const server=createAppServer({reservationService:createReservationService({db})});
  server.on('close',()=>db.close());
  server.on('error', error => {
    if(error.code==='EADDRINUSE')console.error('本機連接埠 '+port+' 已被使用。請先停止舊的服務，再重新啟動。');
    else console.error('本機服務無法啟動：'+error.message);
    process.exitCode=1;
  });
  server.listen(port, '127.0.0.1', () => {
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

module.exports = { createAppServer, buildResponsePayload, extractOutputText, extractProposal, cleanHistory };
