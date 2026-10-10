const TYPES = {
  shower: { label: '淋浴', venue: '寰宇堂頭等貴賓室', duration: 30, icon: 'shower', slots: ['16:30', '17:00', '17:30'] },
  dining: { label: '晚餐', venue: '玲瓏堂頭等貴賓室', duration: 30, icon: 'dining', slots: ['17:30', '18:00', '18:30'] },
  massage: { label: '按摩', venue: '寰宇堂頭等貴賓室', duration: 15, icon: 'spa', slots: ['18:00', '18:30', '18:40'] },
  rest: { label: '休息區', venue: '玲瓏堂頭等貴賓室', duration: 20, icon: 'rest', slots: ['16:00', '17:00', '18:00'] },
  work: { label: '工作', venue: '寰宇堂頭等貴賓室', duration: 20, icon: 'rest', slots: ['17:00', '18:00'] },
  gate: { label: '前往登機口', venue: '步行約 10 分鐘', duration: 10, icon: 'walk', slots: ['19:00'] }
};
const DEFAULT = [
  { id: 1, type: 'shower', start: '17:30', end: '18:00', venue: TYPES.shower.venue, status: 'added' },
  { id: 2, type: 'dining', start: '18:05', end: '18:35', venue: TYPES.dining.venue, status: 'added' },
  { id: 3, type: 'massage', start: '18:40', end: '18:55', venue: TYPES.massage.venue, status: 'pending' },
  { id: 4, type: 'gate', start: '19:00', end: '19:10', venue: TYPES.gate.venue, status: 'none' }
];
const STORAGE = 'lounge-itinerary-v2';
const $ = (s) => document.querySelector(s);
const icon = (name) => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const minutes = (t) => { const [h,m] = t.split(':').map(Number); return h * 60 + m; };
const clock = (n) => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
let activities = typeof document === 'undefined' ? [] : readSaved();
let gate = typeof document === 'undefined' ? '25' : readGate();
let nextId = Math.max(0,...activities.map(a=>a.id)) + 1;
let editingId = null;
let reorderMode = false;
let toastTimer;
let activeRecognition = null;
let demoClock = 17 * 60 + 25;
let aiMode = 'demo';
let sending = false;
let chatTouched = false;
let messages = [
  { role:'user', text:'我想先洗澡，再吃點東西，如果可以也幫我安排按摩。', time:'17:18' },
  { role:'agent', text:'好的，我會為您安排淋浴、晚餐，並視乎可用性為您預約按摩。', time:'17:18' },
  { role:'agent', kind:'plan', text:'已為您安排以下行程；按摩目前候補中，我會持續留意空位。', time:'17:20' },
  { role:'user', text:'這樣來得及登機嗎？', time:'17:21' },
  { role:'agent', text:'來得及。19:00 出發前往登機口，步行約 10 分鐘，仍有 10 分鐘緩衝。', time:'17:21' },
  { role:'agent', kind:'opportunity', time:'17:24' }
];

function readSaved(){
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    if (Array.isArray(saved) && saved.every(a=>TYPES[a.type] && a.start && a.end && Number.isFinite(a.id))) return saved;
  } catch (_) {}
  return DEFAULT.map(a=>({...a}));
}
function readGate(){ try { return localStorage.getItem(STORAGE+'-gate') || '25'; } catch (_) { return '25'; } }
function save(){ try { localStorage.setItem(STORAGE,JSON.stringify(activities)); localStorage.setItem(STORAGE+'-gate',gate); } catch (_) {} }
function toast(text){
  const node=$('#toast'); node.textContent=text; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),3200);
}
function parseTypes(text,selections=new Set()){
  const words={
    shower:/洗澡|淋浴|沖涼|冲凉|沐浴/,
    dining:/吃飯|吃饭|食飯|食饭|食嘢|用餐|晚餐|晚飯|晚饭|午餐|午飯|午饭|早餐|早飯|早饭|吃東西|吃东西|餐點|餐点/,
    massage:/按摩|理療|理疗|舒壓|舒压/,
    rest:/休息|小睡|放鬆|放松/,
    work:/工作|辦公|办公|開會|开会/,
    gate:/前往.{0,6}(?:登機|登机)|去(?:登機|登机)口|去閘口|去闸口/
  };
  const found=Object.entries(words).map(([type,re])=>({type,index:text.search(re)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index).map(x=>x.type);
  selections.forEach(type=>{if(TYPES[type]&&!found.includes(type))found.push(type)});
  return found;
}
function planActivities(requested){
  let cursor=minutes('17:30');
  const scheduled=[], omitted=[];
  for(const type of requested){
    if(type==='gate'||!TYPES[type])continue;
    const end=cursor+TYPES[type].duration;
    if(end>minutes('19:00')){omitted.push(type);continue}
    scheduled.push({type,start:clock(cursor),end:clock(end),venue:TYPES[type].venue,status:type==='massage'?'pending':'added'});
    cursor=end+5;
  }
  if(scheduled.length||requested.includes('gate')) scheduled.push({type:'gate',start:'19:00',end:'19:10',venue:TYPES.gate.venue,status:'none'});
  return {scheduled,omitted};
}
function voiceErrorMessage(error){
  return ({
    'not-allowed':'麥克風未獲允許。請在瀏覽器設定中允許使用麥克風。',
    'NotAllowedError':'麥克風未獲允許。請在瀏覽器設定中允許使用麥克風。',
    'SecurityError':'語音輸入需要安全連線。',
    'audio-capture':'未找到可用麥克風。',
    'no-speech':'未聽到語音，請再試一次。',
    'network':'無法連接語音服務，請改用文字輸入。',
    'language-not-supported':'目前語音引擎不支援所選語言。',
    'aborted':'語音輸入已停止。'
  })[error] || '語音辨識未能啟動，請改用文字輸入。';
}
function sorted(){ return [...activities].sort((a,b)=>minutes(a.start)-minutes(b.start)); }
function statusMarkup(item){
  if(item.type==='gate')return '';
  const labels={pending:'候補中',confirmed:'已確認',added:'已添加',none:'已添加'};
  return '<span class="status '+esc(item.status)+'">'+(item.status==='pending'?icon('clock'):icon('check'))+esc(labels[item.status]||'已添加')+'</span>';
}
function render(){
  const list=$('#activityList');
  list.classList.toggle('reorder-mode',reorderMode);
  list.innerHTML=sorted().map((item,index)=>{
    const type=TYPES[item.type], gateItem=item.type==='gate';
    return '<article class="activity-row" data-id="'+item.id+'"><div class="time-column"><strong>'+esc(item.start)+'</strong><span>'+esc(item.end)+'</span></div><span class="step-dot">'+(index+1)+'</span><div class="activity-photo '+esc(item.type)+'">'+(gateItem?icon('plane'):'')+'</div><div class="activity-detail"><div>'+icon(type.icon)+'<strong>'+esc(gateItem?'前往 G'+gate+' 登機口':type.label)+'</strong></div><small>'+esc(item.venue)+'</small>'+statusMarkup(item)+'</div><div class="row-tools"><button class="edit" type="button" data-id="'+item.id+'" aria-label="編輯'+esc(type.label)+'">'+icon('edit')+'</button>'+(gateItem?'':'<button class="delete" type="button" data-id="'+item.id+'" aria-label="刪除'+esc(type.label)+'">'+icon('trash')+'</button>')+'</div><div class="reorder-tools"><button data-move="up" data-id="'+item.id+'" aria-label="上移">▲</button><button data-move="down" data-id="'+item.id+'" aria-label="下移">▼</button></div></article>';
  }).join('');
  $('#activityCount').textContent=activities.filter(a=>a.type!=='gate').length;
  $('#plannerGate').textContent=gate; $('#stripGate').textContent=gate; $('#agentGate').textContent=gate;
  $('#remainingText').textContent=activities.some(a=>a.status==='pending')?'1 項服務正在候補':'行程已準備就緒';
  const mini=$('#miniTimeline');
  mini.innerHTML=sorted().map((a,i)=>{
    const label=a.type==='gate'?'前往 G'+gate:TYPES[a.type].label;
    return (i?'<span class="mini-sep"></span>':'')+'<span class="mini-item">'+icon(TYPES[a.type].icon)+'<span><b>'+esc(a.start)+'</b><small>'+esc(label)+'</small></span></span>';
  }).join('');
  renderServices();
}
function renderServices(){
  const entries=['shower','dining','massage','rest'];
  $('#serviceList').innerHTML=entries.map(type=>{
    const data=TYPES[type], confirmed=type==='massage'&&activities.some(a=>a.type==='massage'&&a.status==='confirmed');
    const pending=type==='massage'&&!confirmed, label=confirmed?'已安排':pending?'候補':'可添加';
    return '<article class="service-card"><div class="service-photo '+type+'"><span class="service-tag '+(pending?'wait':'')+'">'+label+'</span></div><div class="service-body"><div class="service-name">'+icon(data.icon)+esc(data.label)+'</div><p>'+esc(data.venue)+'</p><div class="time-options">'+data.slots.map(t=>'<span>'+t+'</span>').join('')+'</div><button type="button" data-service="'+type+'">'+(confirmed?'查看行程':pending?'預約候補':'添加至行程')+'</button></div></article>';
  }).join('');
}
function renderChat(){
  const log=$('#chatLog');
  log.innerHTML=messages.map(m=>{
    const user=m.role==='user';
    let content='<p>'+esc(m.text||'')+'</p>';
    if(m.kind==='plan') content+='<div class="chat-plan">'+sorted().map(a=>'<span>'+icon(TYPES[a.type].icon)+esc(a.start)+' '+esc(a.type==='gate'?'前往 G'+gate:TYPES[a.type].label)+'</span>').join('')+'</div>';
    if(m.kind==='opportunity'){
      const confirmed=activities.some(a=>a.type==='massage'&&a.status==='confirmed');
      content='<div class="opportunity-inner"><div class="opportunity-photo"></div><div class="opportunity-copy"><strong>✦ 新機會：18:40 按摩空位已釋出</strong><p>不影響整體行程，建議盡快確認。</p><div class="opportunity-actions">'+(confirmed?'<span class="status confirmed">'+icon('check')+'已確認</span>':'<button data-chat="confirm">立即確認</button><button data-chat="remind">稍後提醒</button>')+'</div></div></div>';
    }
    if(m.kind==='gate') content='<div class="message-title">'+icon('plane')+'登機口已改為 G'+esc(gate)+'</div><p>為確保您有充足時間前往登機口，我們已將離開貴賓室的時間調整為 19:00。</p>';
    if(m.kind==='updated') content='<div class="message-title">'+icon('check')+'行程與預約已更新</div><p>淋浴、晚餐、按摩及離開時間已重新確認，所有預約均已保留。</p>';
    return '<div class="chat-message '+(user?'user':'agent')+' '+(m.kind||'')+'"><span class="avatar">'+icon(user?'rest':'spark')+'</span><div class="bubble">'+content+'<time>'+esc(m.time||nowTime())+'</time></div></div>';
  }).join('');
  log.scrollTop=log.scrollHeight;
}
function nowTime(){ return clock(demoClock++); }
function addMessage(role,text,kind){ messages.push({role,text,kind,time:nowTime()}); renderChat(); }
function showScreen(screen){
  $('#plannerScreen').classList.toggle('active',screen==='planner');
  $('#agentScreen').classList.toggle('active',screen==='agent');
  if(screen==='agent')renderChat();
}
function showSheet(title,body,eyebrow='行程管理'){
  $('#sheetEyebrow').textContent=eyebrow; $('#sheetTitle').textContent=title; $('#sheetBody').innerHTML=body;
  $('#sheet').showModal();
}
function closeSheet(){ $('#sheet').close(); }
function validate(candidate){
  if(!candidate.start||!candidate.end)return '請選擇開始及結束時間。';
  if(activities.find(a=>a.id===editingId)?.type==='gate'&&candidate.type!=='gate')return '登機前需保留前往登機口的活動。';
  if(minutes(candidate.end)<=minutes(candidate.start))return '結束時間需晚於開始時間。';
  if(minutes(candidate.start)<minutes('17:30')||minutes(candidate.end)>minutes('19:15'))return '請安排在 17:30 至 19:15 之間。';
  if(candidate.type==='gate'&&minutes(candidate.end)>minutes('19:10'))return '前往登機口須在 19:10 前完成。';
  if(candidate.type==='gate'&&activities.some(a=>a.id!==editingId&&a.type==='gate'))return '行程中已有前往登機口的活動。';
  const gateItem=activities.find(a=>a.type==='gate'&&a.id!==editingId);
  if(candidate.type!=='gate'&&gateItem&&minutes(candidate.end)>minutes(gateItem.start))return '活動須在前往登機口之前結束。';
  if(candidate.type==='gate'&&activities.some(a=>a.id!==editingId&&a.type!=='gate'&&minutes(a.end)>minutes(candidate.start)))return '請把前往登機口安排在最後。';
  const overlap=activities.some(a=>a.id!==editingId&&minutes(candidate.start)<minutes(a.end)&&minutes(candidate.end)>minutes(a.start));
  return overlap?'此時段與現有行程重疊，請選擇其他時間。':'';
}
function openEdit(item=null,type='shower'){
  editingId=item?.id??null;
  type=item?.type||type;
  const data=TYPES[type], start=item?.start||data.slots.find(t=>minutes(t)>=minutes('17:30'))||'17:30';
  const end=item?.end||clock(minutes(start)+data.duration);
  showSheet(item?'編輯行程':'添加至行程','<form id="activityForm"><label class="field">活動<select id="activityType">'+Object.entries(TYPES).map(([key,t])=>'<option value="'+key+'" '+(key===type?'selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label><div class="field-row"><label class="field">開始時間<input id="activityStart" type="time" value="'+start+'" required></label><label class="field">結束時間<input id="activityEnd" type="time" value="'+end+'" required></label></div><label class="field">服務地點<input id="activityVenue" value="'+esc(item?.venue||data.venue)+'" required></label><p id="sheetError" class="sheet-error" role="alert"></p><button class="sheet-primary" type="submit">保存活動</button></form>');
}
function confirmMassage(fromMessage=false){
  const item=activities.find(a=>a.type==='massage');
  if(item?.status==='confirmed'){toast('按摩時段已確認。');return}
  const conflict=activities.some(a=>a.id!==item?.id&&minutes('18:40')<minutes(a.end)&&minutes('18:55')>minutes(a.start));
  if(conflict){addMessage('agent','18:40 的按摩時段與目前行程衝突。請先修改時間，我會保留候補提醒。');toast('按摩時段與目前行程衝突。');return}
  if(item){item.start='18:40';item.end='18:55';item.status='confirmed'}
  else activities.push({id:nextId++,type:'massage',start:'18:40',end:'18:55',venue:TYPES.massage.venue,status:'confirmed'});
  render(); if(!fromMessage)addMessage('user','太好了，請幫我確認這個按摩時段。'); addMessage('agent','已為您確認 18:40 的按摩預約。我會持續監測航班資訊，如有變動會即時通知您。');
  if(gate==='25'){ gate='31'; render(); messages.push({role:'agent',kind:'gate',time:nowTime()}); messages.push({role:'agent',kind:'updated',time:nowTime()}); renderChat(); }
  save(); closeSheetIfOpen(); toast('按摩已確認，登機口資訊已同步。');
}
function closeSheetIfOpen(){ if($('#sheet').open)closeSheet(); }
function reorder(id,direction){
  const ordered=sorted().filter(a=>a.type!=='gate');
  const i=ordered.findIndex(a=>a.id===id), j=i+(direction==='up'?-1:1);
  if(i<0||j<0||j>=ordered.length)return;
  [ordered[i],ordered[j]]=[ordered[j],ordered[i]];
  let cursor=minutes('17:30');
  const changes=ordered.map(a=>{const change={item:a,start:clock(cursor),end:clock(cursor+TYPES[a.type].duration)};cursor+=TYPES[a.type].duration+5;return change});
  if(cursor-5>minutes('19:00')){ toast('時間不足，無法完成此排序。'); return; }
  let reconfirm=false;
  changes.forEach(({item,start,end})=>{if(item.status==='confirmed'&&(item.start!==start||item.end!==end)){item.status='pending';reconfirm=true}item.start=start;item.end=end});
  render(); toast(reconfirm?'行程順序已更新；按摩新時段需重新確認。':'行程順序已更新。');
}
function generatePlan(text){
  const requested=parseTypes(text,new Set());
  if(!requested.length)return false;
  const result=planActivities(requested);
  activities=result.scheduled.map(a=>({ ...a,id:nextId++ }));
  render();
  if(result.omitted.length) $('#planWarnings').textContent='時間不足，未能加入：'+result.omitted.map(t=>TYPES[t].label).join('、');
  $('#planWarnings').hidden=!result.omitted.length;
  return true;
}
function currentContext(){
  return { gate, activities: sorted().map(a=>({label:TYPES[a.type].label,start:a.start,end:a.end,status:a.status,venue:a.venue})) };
}
async function checkAgentMode(){
  if(typeof location==='undefined')return;
  if(location.protocol==='file:'){
    $('#liveModeLink').hidden=false;
    return;
  }
  if(!/^https?:$/.test(location.protocol))return;
  try{
    const response=await fetch('./api/status');
    if(!response.ok)return;
    const status=await response.json();
    if(status.mode!=='live')return;
    aiMode='live';
    $('#agentModeLabel').textContent='即時 AI 已連接';
    $('.agent-presence').classList.add('live');
    if(!chatTouched){
      messages=[{role:'agent',text:'您好，我已讀取目前的示範行程。您可以直接提出偏好或突發情況，我會根據時間安排提供建議。',time:'17:24'}];
      if(activities.some(a=>a.type==='massage'&&a.status==='pending'))messages.push({role:'agent',kind:'opportunity',time:'17:24'});
      renderChat();
    }
  }catch(_){}
}
function demoReply(text){
  if(/晚到|遲到|迟到/.test(text)){ addMessage('agent','收到。我會以目前到達時間重新檢查行程。若時間不足，建議優先保留晚餐和前往登機口的緩衝。您可在「修改時間」調整每項活動。'); return; }
  if(/延誤|延误/.test(text)){ addMessage('agent','航班延誤時，行程可延長；目前這是示範資料。您可先保留已安排服務，待正式航班資訊更新後再重新優化。'); return; }
  if(/登機口|闸口|閘口/.test(text)){ addMessage('agent','目前示範登機口為 G'+gate+'。我已在行程中預留 10 分鐘步行與緩衝時間。'); return; }
  if(/比較|比较|哪個|哪个/.test(text)){ addMessage('agent','寰宇堂適合淋浴及按摩；玲瓏堂適合晚餐與安靜休息。我可顯示詳細對比。'); openCompare(); return; }
  if(/提前離開|提前离开/.test(text)){ addMessage('agent','了解。請在行程中編輯「前往登機口」的時間，我會檢查與其他活動是否衝突。'); return; }
  if(generatePlan(text)){ addMessage('agent','已依照您的需求重新安排淋浴、晚餐及其他活動。請查看目前計劃；需要預約的按摩會先進入候補。','plan'); return; }
  addMessage('agent','我可以協助調整行程、確認按摩候補、比較貴賓室，以及處理登機口變更。請告訴我您想修改的活動或時間。');
}
async function sendMessage(){
  const input=$('#requestInput'), text=input.value.trim();
  if(!text||sending)return;
  const history=messages.filter(m=>m.text).slice(-8).map(m=>({role:m.role,text:m.text}));
  chatTouched=true;
  input.value=''; addMessage('user',text);
  if(/確認.{0,8}按摩|按摩.{0,8}確認/.test(text)){ confirmMassage(true); return; }
  if(aiMode!=='live'){demoReply(text);return}
  sending=true; $('#sendButton').disabled=true; input.disabled=true;
  const pending={role:'agent',text:'正在根據您的行程整理建議…',kind:'thinking',time:nowTime()};
  messages.push(pending); renderChat();
  try{
    const response=await fetch('./api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history,context:currentContext()})});
    if(!response.ok)throw new Error('AI_UNAVAILABLE');
    const result=await response.json();
    if(typeof result.reply!=='string'||!result.reply.trim())throw new Error('EMPTY_AI_RESPONSE');
    messages=messages.filter(m=>m!==pending);
    addMessage('agent',result.reply.trim());
  }catch(_){
    messages=messages.filter(m=>m!==pending);
    addMessage('agent','即時 AI 暫時無法連線。您的行程仍保留，請稍後再試，或使用下方功能按鈕調整。');
  }finally{
    sending=false; $('#sendButton').disabled=false; input.disabled=false; input.focus();
  }
}
function openCompare(){
  showSheet('貴賓室對比','<div class="compare-grid"><div class="compare-card"><h3>寰宇堂頭等貴賓室</h3><p>適合：淋浴、按摩</p><p>氛圍：私密放鬆</p><p>目前行程：淋浴與按摩</p></div><div class="compare-card"><h3>玲瓏堂頭等貴賓室</h3><p>適合：餐飲、休息</p><p>氛圍：明亮開闊</p><p>目前行程：晚餐</p></div></div><p class="sheet-note">以上為概念原型的示範內容，實際服務以貴賓室當日資訊為準。</p>','智能建議');
}
function openIncident(){
  showSheet('突發修改','<button class="sheet-choice" data-incident="gate"><strong>登機口改為 G31</strong><small>同步更新行程及離開時間</small></button><button class="sheet-choice" data-incident="late"><strong>我會晚到 10 分鐘</strong><small>重新檢查活動銜接與時間</small></button><button class="sheet-choice" data-incident="delay"><strong>航班延誤</strong><small>保留現有服務並等待最新資訊</small></button>','智能應變');
}
function setupVoice(){
  if(window.SpeechRecognition||window.webkitSpeechRecognition)return;
  $('#micButton').classList.add('unavailable');
  $('#speechLang').disabled=true;
  $('#voiceStatus').textContent='此瀏覽器沒有語音辨識引擎，可在輸入框使用裝置聽寫。';
}
function startVoice(){
  if(activeRecognition){try{activeRecognition.stop()}catch(_){}return}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){$('#requestInput').focus();$('#voiceStatus').textContent='此瀏覽器沒有語音辨識引擎。請使用裝置聽寫或文字輸入。';return}
  if(window.isSecureContext===false){$('#voiceStatus').textContent=voiceErrorMessage('SecurityError');return}
  const recognition=new Recognition(); recognition.lang=$('#speechLang').value; recognition.continuous=false; recognition.interimResults=false;
  activeRecognition=recognition;
  recognition.onstart=()=>{$('#micButton').classList.add('listening');$('#voiceStatus').textContent='正在聆聽，請說出您的需求…'};
  recognition.onresult=event=>{
    const spoken=Array.from(event.results).filter(r=>r.isFinal).map(r=>r[0]?.transcript?.trim()).filter(Boolean).join('，');
    if(!spoken)return;
    $('#requestInput').value=spoken;
    if(aiMode==='live'){sendMessage();$('#voiceStatus').textContent='已識別：「'+spoken+'」；正在取得 AI 建議。';return}
    const planned=generatePlan(spoken);
    if(planned){addMessage('user',spoken);addMessage('agent','已根據語音需求更新行程，您可查看目前計劃。','plan');}
    $('#voiceStatus').textContent=planned?'已識別：「'+spoken+'」；行程已更新。':'已識別：「'+spoken+'」。請按發送繼續。';
  };
  recognition.onerror=event=>{$('#voiceStatus').textContent=voiceErrorMessage(event.error)};
  recognition.onend=()=>{activeRecognition=null;$('#micButton').classList.remove('listening')};
  try{recognition.start()}catch(error){activeRecognition=null;$('#voiceStatus').textContent=voiceErrorMessage(error.name)}
}
if(typeof document!=='undefined'){
  $('#openAgent').addEventListener('click',()=>showScreen('agent'));
  $('[data-action="back"]').addEventListener('click',()=>toast('目前已在行程首頁。'));
  $('#backToPlanner').addEventListener('click',()=>showScreen('planner'));
  $('#planPreview').addEventListener('click',()=>showScreen('planner'));
  $('#sendButton').addEventListener('click',sendMessage);
  $('#requestInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendMessage()});
  $('#micButton').addEventListener('click',startVoice);
  $('#closeSheet').addEventListener('click',closeSheet);
  $('#activityList').addEventListener('click',e=>{
    const edit=e.target.closest('button.edit'), del=e.target.closest('button.delete'), move=e.target.closest('[data-move]');
    if(edit)openEdit(activities.find(a=>a.id===Number(edit.dataset.id)));
    if(del){activities=activities.filter(a=>a.id!==Number(del.dataset.id));render();toast('活動已從行程移除。')}
    if(move)reorder(Number(move.dataset.id),move.dataset.move);
  });
  $('#reorderButton').addEventListener('click',()=>{reorderMode=!reorderMode;render();$('#reorderButton').innerHTML=icon('arrows')+(reorderMode?' 完成排序':' 重新排序')});
  $('#serviceList').addEventListener('click',e=>{const b=e.target.closest('[data-service]');if(!b)return; if(b.dataset.service==='massage'){if(activities.some(a=>a.type==='massage'&&a.status==='confirmed')){$('#activityList').scrollIntoView({behavior:'smooth',block:'center'});return}showSheet('按摩候補','<p class="sheet-note">18:40 按摩目前候補中。如有空位釋出，智能助手會提醒您。</p><button class="sheet-primary" data-sheet="agent">查看智能助手提醒</button>','候補管理')}else openEdit(null,b.dataset.service)});
  $('#changeTime').addEventListener('click',()=>showSheet('修改時間','<p class="sheet-note">選擇要調整的行程，系統會檢查時間衝突和登機前緩衝。</p>'+sorted().map(a=>'<button class="sheet-choice" data-edit-id="'+a.id+'"><strong>'+esc(a.start)+' – '+esc(a.end)+'　'+esc(TYPES[a.type].label)+'</strong><small>'+esc(a.venue)+'</small></button>').join('')));
  $('#savePlan').addEventListener('click',()=>{save();toast('行程已保存在此裝置。')});
  $('#viewWaitlist').addEventListener('click',()=>{const pending=activities.filter(a=>a.status==='pending');showSheet('候補進度',pending.length?pending.map(a=>'<div class="sheet-choice"><strong>'+esc(a.start)+'　'+esc(TYPES[a.type].label)+' · 候補中</strong><small>空位釋出後，可由智能助手確認</small></div>').join('')+'<button class="sheet-primary" data-sheet="agent">查看空位提醒</button>':'<p class="sheet-note">目前沒有候補活動，所有已選服務均已安排。</p>','服務狀態')});
  $('#viewAll').addEventListener('click',()=>showSheet('所有可添加行程',Object.entries(TYPES).filter(([key])=>key!=='gate').map(([key,t])=>'<button class="sheet-choice" data-add-type="'+key+'"><strong>'+esc(t.label)+'</strong><small>'+esc(t.venue)+'　·　約 '+t.duration+' 分鐘</small></button>').join(''),'探索服務'));
  $('#chatLog').addEventListener('click',e=>{const b=e.target.closest('[data-chat]');if(!b)return;if(b.dataset.chat==='confirm')confirmMassage();else{addMessage('agent','好的，我稍後會再次提醒您確認 18:40 的按摩空位。');toast('已設定稍後提醒。')}});
  document.querySelectorAll('[data-quick]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.quick==='view')showScreen('planner');
    if(b.dataset.quick==='compare')openCompare();
    if(b.dataset.quick==='incident')openIncident();
    if(b.dataset.quick==='optimize'){const ordered=sorted().filter(a=>a.type!=='gate').map(a=>a.type);const result=planActivities(ordered);activities=result.scheduled.map(a=>({...a,id:nextId++}));render();addMessage('agent','已按登機時間重新優化行程，並保留前往登機口的緩衝。','plan');toast('行程已重新優化。')}
  }));
  $('#sheetBody').addEventListener('click',e=>{
    const edit=e.target.closest('[data-edit-id]'),add=e.target.closest('[data-add-type]'),action=e.target.closest('[data-sheet]'),incident=e.target.closest('[data-incident]');
    if(edit){closeSheet();openEdit(activities.find(a=>a.id===Number(edit.dataset.editId)))}
    if(add){closeSheet();openEdit(null,add.dataset.addType)}
    if(action){closeSheet();showScreen('agent')}
    if(incident){closeSheet();showScreen('agent');if(incident.dataset.incident==='gate'){gate='31';const g=activities.find(a=>a.type==='gate');if(g){g.start='19:00';g.end='19:10'}render();save();messages.push({role:'agent',kind:'gate',time:nowTime()});renderChat()}if(incident.dataset.incident==='late')addMessage('agent','收到您會晚到 10 分鐘。我會優先保留已安排服務，並建議您檢查淋浴與晚餐的銜接。');if(incident.dataset.incident==='delay')addMessage('agent','已記下航班延誤。此原型使用示範航班資料，待正式資訊更新後可重新優化行程。')}
  });
  $('#sheetBody').addEventListener('change',e=>{if(e.target.id==='activityType')$('#activityVenue').value=TYPES[e.target.value].venue});
  $('#sheetBody').addEventListener('submit',e=>{
    if(e.target.id!=='activityForm')return;e.preventDefault();
    const type=$('#activityType').value;
    const candidate={id:editingId??nextId,type,start:$('#activityStart').value,end:$('#activityEnd').value,venue:$('#activityVenue').value.trim()||TYPES[type].venue,status:type==='massage'?'pending':type==='gate'?'none':'added'};
    const err=validate(candidate);if(err){$('#sheetError').textContent=err;return}
    const previous=activities.find(a=>a.id===editingId);
    if(previous?.status==='confirmed'&&previous.type===type&&previous.start===candidate.start&&previous.end===candidate.end&&previous.venue===candidate.venue)candidate.status='confirmed';
    if(editingId)activities=activities.map(a=>a.id===editingId?candidate:a);else{activities.push(candidate);nextId++}
    closeSheet();render();toast(editingId?'行程已更新。':'活動已加入行程。');
  });
  setupVoice();render();renderChat();checkAgentMode();
}
if(typeof module!=='undefined')module.exports={parseTypes,planActivities,voiceErrorMessage};
