const ENGINE = typeof module!=='undefined'&&module.exports ? require('./itinerary.js') : globalThis.ItineraryEngine;
const TYPES = {
  shower: {...ENGINE.SERVICES.shower,icon:'shower',slots:['16:30','17:00','17:30']},
  dining: {...ENGINE.SERVICES.dining,icon:'dining',slots:['17:30','18:00','18:30']},
  massage: {...ENGINE.SERVICES.massage,icon:'spa',slots:['18:00','18:30','18:40']},
  rest: {...ENGINE.SERVICES.rest,icon:'rest',slots:['16:00','17:00','18:00']},
  work: {...ENGINE.SERVICES.work,icon:'rest',slots:['17:00','18:00']},
  gate: {...ENGINE.SERVICES.gate,icon:'walk',slots:['19:00']}
};
const DEFAULT = [
  { id: 1, type: 'shower', start: '17:30', end: '18:00', locationId:TYPES.shower.locationId,venue: TYPES.shower.venue, status: 'added' },
  { id: 2, type: 'dining', start: '18:05', end: '18:35', locationId:TYPES.dining.locationId,venue: TYPES.dining.venue, status: 'added' },
  { id: 3, type: 'massage', start: '18:40', end: '18:55', locationId:TYPES.massage.locationId,venue: TYPES.massage.venue, status: 'pending' },
  { id: 4, type: 'gate', start: '19:00', end: '19:10', locationId:TYPES.gate.locationId,venue: TYPES.gate.venue, status: 'none' }
];
const STORAGE = 'lounge-itinerary-v2';
const ARRIVAL_STORAGE = 'lounge-arrival-time-v1';
const PREFERENCE_STORAGE = 'lounge-preference-history-v1';
const BOOKING_STORAGE = 'lounge-booking-alerts-v1';
const DEMO_AGGREGATE_PREFERENCE = {shower:72,dining:68,massage:55,rest:61,work:34};
const $ = (s) => document.querySelector(s);
const icon = (name) => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const minutes = (t) => { const [h,m] = t.split(':').map(Number); return h * 60 + m; };
const clock = (n) => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
let activities = typeof document === 'undefined' ? [] : readSaved();
let arrivalTime = typeof document === 'undefined' ? '17:30' : readArrivalTime();
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
let bookingAlerts = typeof document==='undefined'?[]:readBookingAlerts();
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
    if (Array.isArray(saved) && saved.every(a=>TYPES[a.type] && a.start && a.end && Number.isFinite(a.id)))
      return saved.map(a=>({...a,locationId:TYPES[a.type].locationId,venue:TYPES[a.type].venue}));
  } catch (_) {}
  return DEFAULT.map(a=>({...a}));
}
function readGate(){ try { return localStorage.getItem(STORAGE+'-gate') || '25'; } catch (_) { return '25'; } }
function readArrivalTime(){try{const value=localStorage.getItem(ARRIVAL_STORAGE);return /^\d{2}:\d{2}$/.test(value||'')&&minutes(value)>=minutes('05:30')&&minutes(value)<=minutes('19:00')?value:'17:30'}catch(_){return '17:30'}}
function readBookingAlerts(){try{const value=JSON.parse(localStorage.getItem(BOOKING_STORAGE));return Array.isArray(value)?value:[]}catch(_){return []}}
function save(){ try { localStorage.setItem(STORAGE,JSON.stringify(activities)); localStorage.setItem(STORAGE+'-gate',gate);localStorage.setItem(ARRIVAL_STORAGE,arrivalTime);localStorage.setItem(BOOKING_STORAGE,JSON.stringify(bookingAlerts)); } catch (_) {} }
function readPreferenceHistory(){try{const value=JSON.parse(localStorage.getItem(PREFERENCE_STORAGE));return Array.isArray(value)?value.filter(Array.isArray):[]}catch(_){return []}}
function recordPreferenceSnapshot(){
  try{
    const history=readPreferenceHistory(),selection=sorted().filter(item=>item.type!=='gate').map(item=>item.type).sort();
    if(selection.length&&JSON.stringify(history.at(-1))!==JSON.stringify(selection))history.push(selection);
    localStorage.setItem(PREFERENCE_STORAGE,JSON.stringify(history.slice(-20)));
  }catch(_){}
}
function recommendationScores(history,current){
  const source=history.length?history.flat():current.filter(item=>item.type!=='gate').map(item=>item.type);
  const total=source.length||1;
  return Object.keys(DEMO_AGGREGATE_PREFERENCE).map(type=>{
    const personal=source.filter(value=>value===type).length;
    const score=(personal/total)*65+DEMO_AGGREGATE_PREFERENCE[type]*.35;
    return {type,personal,crowd:DEMO_AGGREGATE_PREFERENCE[type],score};
  }).sort((a,b)=>b.score-a.score);
}
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
  let cursor=minutes(arrivalTime);
  const scheduled=[], omitted=[];
  for(const type of requested){
    if(type==='gate'||!TYPES[type])continue;
    const end=cursor+TYPES[type].duration;
    if(end>minutes('19:00')){omitted.push(type);continue}
    scheduled.push({type,start:clock(cursor),end:clock(end),locationId:TYPES[type].locationId,venue:TYPES[type].venue,status:type==='massage'?'pending':'added'});
    cursor=end+5;
  }
  if(scheduled.length||requested.includes('gate')) scheduled.push({type:'gate',start:'19:00',end:'19:10',locationId:TYPES.gate.locationId,venue:TYPES.gate.venue,status:'none'});
  return {scheduled,omitted};
}
function cancellationRequest(text,items){
  if(/如果|假如|假設|假设|不想取消|不要取消|別取消|别取消/.test(text))return null;
  if(!/取消|撤銷|撤销|移除|刪除|删除|不要|不用/.test(text))return null;
  const types=parseTypes(text).filter(type=>type!=='gate');
  const times=[...text.matchAll(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g)].map(match=>match[1].padStart(2,'0')+':'+match[2]);
  if(!types.length&&!times.length)return {ids:[],ambiguous:true};
  const matched=items.filter(item=>item.type!=='gate'&&(!types.length||types.includes(item.type))&&(!times.length||times.includes(item.start)));
  if(types.length===1&&!times.length&&matched.length>1)return {ids:[],ambiguous:true};
  return {ids:matched.map(item=>item.id),ambiguous:false};
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
function availableDuration(){const total=minutes('19:15')-minutes(arrivalTime);return Math.floor(total/60)+'小時'+String(total%60).padStart(2,'0')+'分'}
function locationLine(type){
  const service=TYPES[type];
  return type==='gate'?service.venue:service.venue+' · '+service.area;
}
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
    return '<article class="activity-row" data-id="'+item.id+'"><div class="time-column"><strong>'+esc(item.start)+'</strong><span>'+esc(item.end)+'</span></div><span class="step-dot">'+(index+1)+'</span><div class="activity-photo '+esc(item.type)+'">'+(gateItem?icon('plane'):'')+'</div><div class="activity-detail"><div>'+icon(type.icon)+'<strong>'+esc(gateItem?'前往 G'+gate+' 登機口':type.label)+'</strong></div><small>'+esc(locationLine(item.type))+'</small>'+statusMarkup(item)+'</div><div class="row-tools"><button class="edit" type="button" data-id="'+item.id+'" aria-label="編輯'+esc(type.label)+'">'+icon('edit')+'</button>'+(gateItem?'':'<button class="delete" type="button" data-id="'+item.id+'" aria-label="刪除'+esc(type.label)+'">'+icon('trash')+'</button>')+'</div><div class="reorder-tools"><button data-move="up" data-id="'+item.id+'" aria-label="上移">▲</button><button data-move="down" data-id="'+item.id+'" aria-label="下移">▼</button></div></article>';
  }).join('');
  const duration=availableDuration();
  $('#heroDuration').textContent=duration;
  $('#overviewDuration').textContent=duration;
  $('#agentDuration').textContent=duration.replace('分','分鐘');
  $('#heroWindow').textContent=arrivalTime+' — 19:15';
  $('#overviewWindow').textContent=arrivalTime+' – 19:15';
  $('#activityCount').textContent=activities.filter(a=>a.type!=='gate').length;
  $('#plannerGate').textContent=gate; $('#stripGate').textContent=gate; $('#agentGate').textContent=gate;
  const pendingCount=activities.filter(a=>a.status==='pending').length;
  $('#remainingText').textContent=pendingCount?pendingCount+' 項服務正在候補':'行程已準備就緒';
  const bookingNotice=$('#bookingNotice');
  bookingNotice.hidden=!bookingAlerts.length;
  bookingNotice.textContent=bookingAlerts.length?'預約提醒：'+bookingAlerts.at(-1):'';
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
    const data=TYPES[type], massage=type==='massage'?activities.find(a=>a.type==='massage'):null;
    const confirmed=massage?.status==='confirmed', pending=massage?.status==='pending';
    const label=confirmed?'已安排':pending?'候補中':type==='massage'?'可候補':'可添加';
    const displayedSlots=data.slots.filter(time=>minutes(time)>=minutes(arrivalTime));
    return '<article class="service-card"><div class="service-photo '+type+'"><span class="service-tag '+(pending?'wait':'')+'">'+label+'</span></div><div class="service-body"><div class="service-name">'+icon(data.icon)+esc(data.label)+'</div><p>'+esc(locationLine(type))+'</p><div class="time-options">'+(displayedSlots.length?displayedSlots.map(t=>'<span>'+t+'</span>').join(''):'<span>可自訂時間</span>')+'</div><button type="button" data-service="'+type+'">'+(confirmed?'查看行程':pending?'查看候補':type==='massage'?'預約候補':'添加至行程')+'</button></div></article>';
  }).join('');
}
function renderChat(){
  const log=$('#chatLog');
  log.innerHTML=messages.map((m,index)=>{
    const user=m.role==='user';
    let content='<p>'+esc(m.text||'')+'</p>';
    if(m.kind==='plan') content+='<div class="chat-plan">'+sorted().map(a=>'<span>'+icon(TYPES[a.type].icon)+esc(a.start)+' '+esc(a.type==='gate'?'前往 G'+gate:TYPES[a.type].label)+'</span>').join('')+'</div>';
    if(m.kind==='opportunity'){
      const massage=activities.find(a=>a.type==='massage');
      if(!massage)content='<div class="message-title">'+icon('check')+'按摩時段已從示範行程移除</div><p>需要時可從「可添加行程」重新選擇。</p>';
      else content='<div class="opportunity-inner"><div class="opportunity-photo"></div><div class="opportunity-copy"><strong>✦ 按摩候補進度</strong><p>查看示範空位與排隊名次；實際預約資料尚未連接。</p><div class="opportunity-actions">'+(massage.status==='confirmed'?'<span class="status confirmed">'+icon('check')+'已確認</span>':'<button data-chat="availability">查看候補詳情</button>')+'</div></div></div>';
    }
    if(m.kind==='gate') content='<div class="message-title">'+icon('plane')+'登機口已改為 G'+esc(gate)+'</div><p>為確保您有充足時間前往登機口，我們已將離開貴賓室的時間調整為 19:00。</p>';
    if(m.kind==='updated') content='<div class="message-title">'+icon('check')+'行程時間已更新</div><p>請按最新登機口與候機時間檢查行程；服務預約狀態仍以實際預約系統為準。</p>';
    if(m.kind==='proposal'){
      const proposal=m.proposal;
      const changes=proposal.diff.map(change=>{
        const item=change.after||change.before;
        const label=change.kind==='added'?'新增':change.kind==='removed'?'移除':'更改';
        const time=change.kind==='updated'?change.before.start+' → '+change.after.start:item.start;
        return '<span class="proposal-change '+change.kind+'">'+esc(label)+' · '+esc(time)+' '+esc(TYPES[item.type].label)+'</span>';
      }).join('');
      const rows=[...proposal.draft].sort((a,b)=>minutes(a.start)-minutes(b.start)).map(item=>{
        const changed=proposal.diff.some(change=>change.after?.id===item.id);
        const status={confirmed:'已確認',pending:'候補／需確認',added:'已規劃',none:'出發'}[item.status]||'已規劃';
        return '<div class="proposal-row '+(changed?'changed':'')+'"><strong>'+esc(item.start)+'–'+esc(item.end)+'</strong><span>'+esc(item.type==='gate'?'前往 G'+gate+' 登機口':TYPES[item.type].label)+'</span><small>'+esc(status)+'</small></div>';
      }).join('');
      const warning=proposal.warnings.length?'<div class="proposal-warnings">'+proposal.warnings.map(value=>'<p>'+esc(value)+'</p>').join('')+'</div>':'';
      const actions=proposal.status==='pending'?'<div class="proposal-actions"><button type="button" data-proposal="cancel" data-index="'+index+'">取消修改</button><button type="button" data-proposal="confirm" data-index="'+index+'">確認並保存</button></div>':'<div class="proposal-result">'+esc({applied:'已確認並保存',cancelled:'已取消修改',stale:'行程已變動，請重新提出修改'}[proposal.status]||'')+'</div>';
      content='<div class="message-title">'+icon('calendar')+'行程修改預覽</div><p>'+esc(proposal.explanation)+'</p><div class="proposal-changes">'+changes+'</div><div class="proposal-list">'+rows+'</div>'+warning+(proposal.error?'<p class="proposal-error">'+esc(proposal.error)+'</p>':'')+actions;
    }
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
  if(!ENGINE)return '行程驗證模組尚未載入。';
  const draft=editingId?activities.map(item=>item.id===editingId?candidate:item):[...activities,candidate];
  const checked=ENGINE.validateItinerary(draft,proposalPolicy());
  return checked.errors[0]||'';
}
function openEdit(item=null,type='shower'){
  editingId=item?.id??null;
  type=item?.type||type;
  const data=TYPES[type], start=item?.start||data.slots.find(t=>minutes(t)>=minutes(arrivalTime))||arrivalTime;
  const end=item?.end||clock(minutes(start)+data.duration);
  showSheet(item?'編輯行程':'添加至行程','<form id="activityForm"><label class="field">活動<select id="activityType">'+Object.entries(TYPES).map(([key,t])=>'<option value="'+key+'" '+(key===type?'selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label><div class="field-row"><label class="field">開始時間<input id="activityStart" type="time" value="'+start+'" required></label><label class="field">結束時間<input id="activityEnd" type="time" value="'+end+'" required></label></div><div id="activityLocation" class="location-card">'+locationCard(type)+'</div><p class="sheet-note">地點來自固定的貴賓室設施資料；時間與預約狀態仍屬示範。已確認預約改時段後需重新確認。</p><p id="sheetError" class="sheet-error" role="alert"></p><button class="sheet-primary" type="submit">保存活動</button></form>');
}
function locationCard(type){
  const service=TYPES[type];
  if(type==='gate')return '<strong>登機口 G'+esc(gate)+'</strong><small>依目前示範航班資料顯示</small>';
  const location=ENGINE.LOCATIONS[service.locationId];
  return '<small>實際貴賓室設施</small><strong>'+esc(location.name)+' · '+esc(service.area)+'</strong><span>'+esc(location.address)+'</span><a href="'+esc(location.url)+'" target="_blank" rel="noopener noreferrer">查看國泰官方介紹 ↗</a>';
}
function proposalPolicy(original=activities){return {gate,boardingTime:'19:20',windowStart:arrivalTime,windowEnd:'19:15',boardingBuffer:10,originalActivities:original}}
function showArrivalSheet(){
  showSheet('修改到達時間','<form id="arrivalForm"><label class="field">到達貴賓室時間<input id="arrivalInput" type="time" min="05:30" max="19:00" value="'+esc(arrivalTime)+'" required></label><p class="sheet-note">到達時間可早於 17:30。新的活動可從到達後開始；若改為較晚到達，請先調整較早的活動。</p><p id="arrivalError" class="sheet-error" role="alert"></p><button class="sheet-primary" type="submit">保存到達時間</button></form>','行程時間');
}
function waitlistContent(data){
  const slots=Array.isArray(data?.slots)?data.slots:[];
  const pending=activities.filter(item=>item.status==='pending');
  const queue=pending.length?pending.map(item=>{
    const slot=slots.find(value=>value.type===item.type&&value.start===item.start);
    const rank=slot&&Number.isInteger(slot.queue)?'示範排隊第 '+slot.queue+' 名':'此時段暫無排隊樣本';
    const open=slot&&Number.isInteger(slot.available)?' · 示範空位 '+slot.available+' 個':'';
    return '<div class="waitlist-row"><strong>'+esc(item.start)+' '+esc(TYPES[item.type].label)+'</strong><span>'+esc(locationLine(item.type))+'</span><b>'+esc(rank+open)+'</b></div>';
  }).join(''):'<p class="sheet-note">目前行程沒有候補活動。</p>';
  const openSlots=slots.filter(slot=>TYPES[slot.type]&&slot.type!=='gate'&&typeof slot.start==='string'&&Number.isInteger(slot.available)&&slot.available>0&&minutes(slot.start)>=minutes(arrivalTime));
  const available=openSlots.length?openSlots.map(slot=>'<div class="waitlist-row"><strong>'+esc(slot.start)+' '+esc(TYPES[slot.type].label)+'</strong><span>'+esc(locationLine(slot.type))+'</span><b>示範空位 '+slot.available+' 個</b></div>').join(''):'<p class="sheet-note">目前樣本中沒有可顯示的空位。</p>';
  return '<p class="sheet-note">示範預約資料｜未連接真實預約系統。空位和名次不能用於實際預約；加入行程前仍需檢查時間衝突。</p><h3 class="waitlist-heading">我的候補</h3>'+queue+'<h3 class="waitlist-heading">目前顯示的空位</h3>'+available;
}
async function showWaitlist(){
  showSheet('空位與候補進度','<p class="sheet-note">正在讀取示範預約資料…</p>','候補管理');
  let data=ENGINE.DEMO_AVAILABILITY;
  if(typeof location!=='undefined'&&location.protocol!=='file:'){
    try{const response=await fetch('./api/availability');if(response.ok)data=await response.json()}catch(_){}
  }
  if($('#sheet').open)$('#sheetBody').innerHTML=waitlistContent(data);
}
function stageProposal(payload){
  if(!ENGINE){addMessage('agent','行程驗證模組尚未載入，請重新整理頁面。');return false}
  try{
    const original=activities.map(item=>({...item}));
    const draft=ENGINE.applyProposalToDraft(original,payload.operations);
    const checked=ENGINE.validateItinerary(draft,proposalPolicy(original));
    if(!checked.valid){addMessage('agent','目前無法預覽這項修改：'+checked.errors.join(' '));return false}
    const diff=ENGINE.diffItineraries(original,draft);
    if(!diff.length){addMessage('agent','行程沒有需要更改的項目。');return false}
    const proposal={operations:payload.operations.map(operation=>({...operation})),draft,diff,
      explanation:payload.explanation||'請檢查以下建議行程。',
      warnings:[...new Set([...(Array.isArray(payload.warnings)?payload.warnings:[]),...checked.warnings])],
      baseSignature:ENGINE.itinerarySignature(original,proposalPolicy(original)),status:'pending',error:''};
    messages.push({role:'agent',kind:'proposal',text:proposal.explanation,proposal,time:nowTime()});renderChat();
    return true;
  }catch(error){addMessage('agent','無法建立安全的行程預覽：'+error.message);return false}
}
function decideProposal(index,decision){
  const entry=messages[index],proposal=entry?.proposal;
  if(!proposal||proposal.status!=='pending')return false;
  if(decision==='cancel'){
    proposal.status='cancelled';renderChat();addMessage('agent','已取消這次修改，原有行程保持不變。');return true;
  }
  if(decision!=='confirm')return false;
  if(ENGINE.itinerarySignature(activities,proposalPolicy())!==proposal.baseSignature){
    proposal.status='stale';renderChat();addMessage('agent','行程已在預覽後變更。請重新提出需求，我會按最新行程產生預覽。');return false;
  }
  try{
    const draft=ENGINE.applyProposalToDraft(activities,proposal.operations);
    const checked=ENGINE.validateItinerary(draft,proposalPolicy());
    if(!checked.valid){proposal.error=checked.errors.join(' ');renderChat();return false}
    activities=draft;
    nextId=Math.max(nextId,...activities.map(item=>item.id+1));
    bookingAlerts=[...new Set([...bookingAlerts,...checked.warnings])].slice(-8);
    proposal.status='applied';
    save();recordPreferenceSnapshot();render();renderChat();
    addMessage('agent','已按您確認的預覽更新並保存在此裝置的行程。'+(checked.warnings.length?' 涉及的實際預約仍需另行處理。':''));
    toast('行程已確認並保存。');
    return true;
  }catch(error){proposal.error=error.message;renderChat();return false}
}
function reorder(id,direction){
  const ordered=sorted().filter(a=>a.type!=='gate');
  const i=ordered.findIndex(a=>a.id===id), j=i+(direction==='up'?-1:1);
  if(i<0||j<0||j>=ordered.length)return;
  [ordered[i],ordered[j]]=[ordered[j],ordered[i]];
  let cursor=minutes(arrivalTime);
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
  return {flightNumber:'CX251',boardingTime:'19:20',gate,windowStart:arrivalTime,windowEnd:'19:15',boardingBuffer:10,
    activities:sorted().map(a=>({id:a.id,type:a.type,label:TYPES[a.type].label,start:a.start,end:a.end,status:a.status,locationId:a.locationId,venue:a.venue,area:TYPES[a.type].area}))};
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
    $('#agentModeLabel').textContent='DeepSeek AI 已啟用';
    $('.agent-presence').classList.add('live');
    if(!chatTouched){
      messages=[{role:'agent',text:'您好，我已讀取目前的示範行程。您可以直接提出偏好或突發情況，我會根據時間安排提供建議。',time:'17:24'}];
      if(activities.some(a=>a.type==='massage'&&a.status==='pending'))messages.push({role:'agent',kind:'opportunity',time:'17:24'});
      renderChat();
    }
  }catch(_){}
}
function demoReply(text){
  const cancellation=cancellationRequest(text,activities);
  if(cancellation){
    if(cancellation.ambiguous){addMessage('agent','請說明要取消哪項活動或開始時間。');return}
    if(!cancellation.ids.length){addMessage('agent','目前行程中找不到要取消的活動。');return}
    stageProposal({explanation:'建議從示範行程移除指定活動，其他活動保持不變。',operations:cancellation.ids.map(id=>({op:'remove',id}))});return;
  }
  if(/晚到|遲到|迟到/.test(text)){ addMessage('agent','收到。我會以目前到達時間重新檢查行程。若時間不足，建議優先保留晚餐和前往登機口的緩衝。您可在「修改時間」調整每項活動。'); return; }
  if(/延誤|延误/.test(text)){ addMessage('agent','航班延誤時，行程可延長；目前這是示範資料。您可先保留已安排服務，待正式航班資訊更新後再重新優化。'); return; }
  if(/登機口|闸口|閘口/.test(text)){ addMessage('agent','目前示範登機口為 G'+gate+'。我已在行程中預留 10 分鐘步行與緩衝時間。'); return; }
  if(/比較|比较|哪個|哪个/.test(text)){ addMessage('agent','寰宇堂提供淋浴、晚餐及按摩；玲瓏堂可作安靜休息備選。我已列出到登機口的示範步行時間。'); openCompare(); return; }
  if(/提前離開|提前离开/.test(text)){ addMessage('agent','了解。請在行程中編輯「前往登機口」的時間，我會檢查與其他活動是否衝突。'); return; }
  if(parseTypes(text).length){addMessage('agent','目前是演示模式。請啟動本機 DeepSeek 服務，讓我為您產生可確認的完整行程預覽。');return}
  addMessage('agent','我可以展示行程、智能推薦和貴賓室對比。複雜行程修改請啟動本機 DeepSeek 服務。');
}
async function sendMessage(){
  const input=$('#requestInput'), text=input.value.trim();
  if(!text||sending)return;
  const history=messages.filter(m=>m.text).slice(-8).map(m=>({role:m.role,text:m.text}));
  chatTouched=true;
  input.value=''; addMessage('user',text);
  if(/確認.{0,8}按摩|按摩.{0,8}確認/.test(text)){addMessage('agent','目前沒有連接實際預約系統。您可以在「查看候補」查看示範空位與排隊名次。');showWaitlist();return}
  if(aiMode!=='live'){demoReply(text);return}
  sending=true; $('#sendButton').disabled=true; input.disabled=true;
  const pending={role:'agent',text:'正在根據您的行程整理建議…',kind:'thinking',time:nowTime()};
  messages.push(pending); renderChat();
  try{
    const response=await fetch('./api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history,context:currentContext()})});
    if(!response.ok){
      const failure=await response.json().catch(()=>({}));
      throw new Error(failure.error||'AI_UNAVAILABLE');
    }
    const result=await response.json();
    messages=messages.filter(m=>m!==pending);
    if(result.type==='itinerary_proposal')stageProposal(result);
    else if(typeof result.reply==='string'&&result.reply.trim())addMessage('agent',result.reply.trim());
    else throw new Error('EMPTY_AI_RESPONSE');
  }catch(error){
    messages=messages.filter(m=>m!==pending);
    const detail={
      AI_AUTH_FAILED:'DeepSeek API key 無效，請檢查並重新啟動本機服務。',
      AI_BALANCE_LOW:'DeepSeek 帳戶餘額不足，請檢查帳戶餘額。',
      AI_RATE_LIMITED:'DeepSeek 請求過於頻繁，請稍後再試。'
    }[error.message]||'DeepSeek 暫時無法連線，請稍後再試。';
    addMessage('agent',detail+'您的行程仍保留。');
  }finally{
    sending=false; $('#sendButton').disabled=false; input.disabled=false; input.focus();
  }
}
function openCompare(){
  const walks=gate==='31'?{wing:11,pier:14}:{wing:9,pier:18};
  const wing=activities.filter(item=>item.venue===TYPES.shower.venue).map(item=>TYPES[item.type].label).join('、')||'尚未安排';
  const pier=activities.filter(item=>item.venue===TYPES.rest.venue).map(item=>TYPES[item.type].label).join('、')||'尚未安排';
  showSheet('貴賓室對比','<div class="compare-grid"><div class="compare-card"><h3>寰宇堂頭等貴賓室</h3><p>位置：一號客運大樓 7 樓，鄰近 1 至 4 號閘口</p><p>設施：淋浴間、饌薈廳、悠然軒</p><p>至 G'+esc(gate)+'：示範估算約 <strong>'+walks.wing+' 分鐘</strong></p><p>目前行程：'+esc(wing)+'</p></div><div class="compare-card"><h3>玲瓏堂</h3><p>位置：一號客運大樓 7 樓，鄰近 6 號閘口</p><p>適合：休息、工作</p><p>至 G'+esc(gate)+'：示範估算約 <strong>'+walks.pier+' 分鐘</strong></p><p>目前行程：'+esc(pier)+'</p></div></div><p class="sheet-note">貴賓室位置來自國泰官方資料；至登機口的步行時間是原型估算，並非機場即時路線。</p>','智能建議');
}
function showRecommendations(){
  const history=readPreferenceHistory(),scores=recommendationScores(history,activities);
  const newChoices=scores.filter(item=>!activities.some(activity=>activity.type===item.type));
  const ranked=[...scores.filter(item=>activities.some(activity=>activity.type===item.type)).slice(0,2),...newChoices.slice(0,1)].slice(0,3);
  const cards=ranked.map((item,index)=>{
    const scheduled=activities.some(activity=>activity.type===item.type);
    const source=history.length?'本機過去保存記錄 '+item.personal+' 次':'目前行程偏好 '+item.personal+' 次';
    return '<div class="recommend-card"><div><span class="recommend-rank">'+(index+1)+'</span><strong>'+esc(TYPES[item.type].label)+'</strong><small>'+esc(TYPES[item.type].venue)+'</small></div><p>'+esc(source)+' · 示範群體偏好 '+item.crowd+'%</p>'+(scheduled?'<span class="recommend-added">已在行程</span>':'<button type="button" data-add-type="'+item.type+'">添加至行程</button>')+'</div>';
  }).join('');
  showSheet('智能推薦','<p class="sheet-note">依本機已保存行程的個人偏好及示範群體偏好排序。群體比例為原型樣本，並非真實所有旅客資料。</p><div class="recommend-list">'+cards+'</div>','為您推薦');
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
    $('#voiceStatus').textContent='已識別：「'+spoken+'」。請按發送提出需求。';
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
  $('#changeArrival').addEventListener('click',showArrivalSheet);
  $('#closeSheet').addEventListener('click',closeSheet);
  $('#activityList').addEventListener('click',e=>{
    const edit=e.target.closest('button.edit'), del=e.target.closest('button.delete'), move=e.target.closest('[data-move]');
    if(edit)openEdit(activities.find(a=>a.id===Number(edit.dataset.id)));
    if(del){activities=activities.filter(a=>a.id!==Number(del.dataset.id));render();renderChat();save();toast('活動已從行程移除。')}
    if(move)reorder(Number(move.dataset.id),move.dataset.move);
  });
  $('#reorderButton').addEventListener('click',()=>{reorderMode=!reorderMode;render();$('#reorderButton').innerHTML=icon('arrows')+(reorderMode?' 完成排序':' 重新排序')});
  $('#serviceList').addEventListener('click',e=>{const b=e.target.closest('[data-service]');if(!b)return; if(b.dataset.service==='massage'){const item=activities.find(a=>a.type==='massage');if(item?.status==='confirmed'){$('#activityList').scrollIntoView({behavior:'smooth',block:'center'});return}if(!item){openEdit(null,'massage');return}showWaitlist()}else openEdit(null,b.dataset.service)});
  $('#changeTime').addEventListener('click',()=>showSheet('修改時間','<p class="sheet-note">可先修改到達貴賓室的時間，再安排更早的活動。</p><button class="sheet-choice" data-arrival="open"><strong>到達貴賓室　'+esc(arrivalTime)+'</strong><small>修改候機時段起點</small></button>'+sorted().map(a=>'<button class="sheet-choice" data-edit-id="'+a.id+'"><strong>'+esc(a.start)+' – '+esc(a.end)+'　'+esc(TYPES[a.type].label)+'</strong><small>'+esc(locationLine(a.type))+'</small></button>').join('')));
  $('#savePlan').addEventListener('click',()=>{save();recordPreferenceSnapshot();toast('行程已保存在此裝置。')});
  $('#viewWaitlist').addEventListener('click',showWaitlist);
  $('#viewAll').addEventListener('click',()=>showSheet('所有可添加行程',Object.entries(TYPES).filter(([key])=>key!=='gate').map(([key,t])=>'<button class="sheet-choice" data-add-type="'+key+'"><strong>'+esc(t.label)+'</strong><small>'+esc(locationLine(key))+'　·　約 '+t.duration+' 分鐘</small></button>').join(''),'探索服務'));
  $('#chatLog').addEventListener('click',e=>{const b=e.target.closest('[data-chat]');if(b?.dataset.chat==='availability')showWaitlist()});
  $('#chatLog').addEventListener('click',e=>{const button=e.target.closest('[data-proposal]');if(button)decideProposal(Number(button.dataset.index),button.dataset.proposal)});
  document.querySelectorAll('[data-quick]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.quick==='view')showScreen('planner');
    if(b.dataset.quick==='compare')openCompare();
    if(b.dataset.quick==='recommend')showRecommendations();
    if(b.dataset.quick==='incident')openIncident();
    if(b.dataset.quick==='optimize'){
      const existing=sorted().filter(a=>a.type!=='gate');
      const result=planActivities(existing.map(a=>a.type));
      if(result.omitted.length){addMessage('agent','目前時段不足以容納全部活動，請先選擇要保留的服務。');return}
      const operations=existing.flatMap((item,index)=>{
        const target=result.scheduled[index];
        return item.start===target.start&&item.end===target.end?[]:[{op:'update',id:item.id,start:target.start,end:target.end}];
      });
      if(!operations.length){addMessage('agent','目前行程已符合登機前的時間安排。');return}
      stageProposal({explanation:'建議按現有活動順序重新安排時間。請確認完整行程；已確認的預約若改時段，仍需重新確認。',operations});
    }
  }));
  $('#sheetBody').addEventListener('click',e=>{
    const edit=e.target.closest('[data-edit-id]'),add=e.target.closest('[data-add-type]'),action=e.target.closest('[data-sheet]'),incident=e.target.closest('[data-incident]'),arrival=e.target.closest('[data-arrival]');
    if(arrival){closeSheet();showArrivalSheet()}
    if(edit){closeSheet();openEdit(activities.find(a=>a.id===Number(edit.dataset.editId)))}
    if(add){closeSheet();openEdit(null,add.dataset.addType)}
    if(action){closeSheet();showScreen('agent')}
    if(incident){closeSheet();showScreen('agent');if(incident.dataset.incident==='gate'){gate='31';const g=activities.find(a=>a.type==='gate');if(g){g.start='19:00';g.end='19:10'}render();save();messages.push({role:'agent',kind:'gate',time:nowTime()});renderChat()}if(incident.dataset.incident==='late')addMessage('agent','收到您會晚到 10 分鐘。我會優先保留已安排服務，並建議您檢查淋浴與晚餐的銜接。');if(incident.dataset.incident==='delay')addMessage('agent','已記下航班延誤。此原型使用示範航班資料，待正式資訊更新後可重新優化行程。')}
  });
  $('#sheetBody').addEventListener('change',e=>{
    if(e.target.id==='activityType')$('#activityLocation').innerHTML=locationCard(e.target.value);
    if(e.target.id==='activityType'||e.target.id==='activityStart'){
      const start=$('#activityStart').value;
      if(/^\d{2}:\d{2}$/.test(start))$('#activityEnd').value=clock(minutes(start)+TYPES[$('#activityType').value].duration);
    }
  });
  $('#sheetBody').addEventListener('submit',e=>{
    if(e.target.id==='arrivalForm'){
      e.preventDefault();
      const proposed=$('#arrivalInput').value;
      if(!/^\d{2}:\d{2}$/.test(proposed)||minutes(proposed)<minutes('05:30')||minutes(proposed)>minutes('19:00')){$('#arrivalError').textContent='請選擇 05:30 至 19:00 之間的時間。';return}
      const checked=ENGINE.validateItinerary(activities,{...proposalPolicy(),windowStart:proposed});
      if(!checked.valid){$('#arrivalError').textContent=checked.errors[0]+' 請先調整較早的活動。';return}
      arrivalTime=proposed;save();render();closeSheet();toast('到達時間已更新，可安排較早的活動。');return;
    }
    if(e.target.id!=='activityForm')return;e.preventDefault();
    const type=$('#activityType').value;
    const previous=activities.find(a=>a.id===editingId);
    const candidate={id:editingId??nextId,type,start:$('#activityStart').value,end:$('#activityEnd').value,locationId:TYPES[type].locationId,venue:TYPES[type].venue,status:type==='massage'?'pending':type==='gate'?'none':'added'};
    if(previous)candidate.status=previous.type===type&&previous.start===candidate.start&&previous.end===candidate.end&&previous.venue===candidate.venue?previous.status:previous.status==='confirmed'?'pending':candidate.status;
    const err=validate(candidate);if(err){$('#sheetError').textContent=err;return}
    if(editingId)activities=activities.map(a=>a.id===editingId?candidate:a);else{activities.push(candidate);nextId++}
    closeSheet();render();toast(editingId?'行程已更新。':'活動已加入行程。');
  });
  setupVoice();render();renderChat();checkAgentMode();
}
if(typeof module!=='undefined')module.exports={parseTypes,planActivities,voiceErrorMessage};
