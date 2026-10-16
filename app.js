const ENGINE = typeof module!=='undefined'&&module.exports ? require('./itinerary.js') : globalThis.ItineraryEngine;
const TRAVEL = typeof module!=='undefined'&&module.exports ? require('./travel-time.js') : globalThis.LoungeTravelTimes||ENGINE.travel;
const TYPES = {
  shower: {...ENGINE.SERVICES.shower,icon:'shower',slots:['16:30','17:00','17:30']},
  dining: {...ENGINE.SERVICES.dining,icon:'dining',slots:['17:30','18:00','18:30']},
  massage: {...ENGINE.SERVICES.massage,icon:'spa',slots:['18:00','18:30','18:40']},
  rest: {...ENGINE.SERVICES.rest,icon:'rest',slots:['16:00','17:00','18:00']},
  work: {...ENGINE.SERVICES.work,icon:'rest',slots:['17:00','18:00']},
  gate: {...ENGINE.SERVICES.gate,icon:'walk',slots:['19:00']}
};
const DEFAULT = [
  { id: 1, type: 'shower', start: '17:30', end: '18:00', ...ENGINE.resolveServiceLocation('shower','wing'), status: 'confirmed' },
  { id: 2, type: 'dining', start: '18:05', end: '18:35', ...ENGINE.resolveServiceLocation('dining','wing'), status: 'added' },
  { id: 3, type: 'massage', start: '18:40', end: '18:55', ...ENGINE.resolveServiceLocation('massage','wing'), status: 'pending' },
  { id: 4, type: 'gate', start: '19:00', end: '19:10', locationId:TYPES.gate.locationId,venue: TYPES.gate.venue, status: 'none' }
];
const STORAGE = 'lounge-itinerary-v2';
const ARRIVAL_STORAGE = 'lounge-arrival-time-v1';
const BOARDING_STORAGE = 'lounge-boarding-time-v1';
const JOURNEY_STORAGE = 'lounge-recovery-journey-v1';
const PREFERENCE_STORAGE = 'lounge-preference-history-v1';
const BOOKING_STORAGE = 'lounge-booking-alerts-v1';
const DEMO_AGGREGATE_PREFERENCE = {shower:72,dining:68,massage:55,rest:61,work:34};
const $ = (s) => document.querySelector(s);
const icon = (name) => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const minutes = (t) => { const [h,m] = t.split(':').map(Number); return h * 60 + m; };
const clock = (n) => {n=((n%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0')};
let activities = typeof document === 'undefined' ? [] : readSaved();
let arrivalTime = typeof document === 'undefined' ? '17:30' : readArrivalTime();
let boardingTime = typeof document === 'undefined' ? '19:20' : readBoardingTime();
let gate = typeof document === 'undefined' ? '25' : readGate();
let recoveryJourney=typeof document==='undefined'?null:readJourney();
let recoveryBusy=false,recoveryRisk='';
let bookingUI=null;
if(recoveryJourney){arrivalTime=recoveryJourney.expectedLoungeArrivalAt.slice(11,16);boardingTime=recoveryJourney.boardingAt.slice(11,16);gate=recoveryJourney.gate;}
let nextId = Math.max(0,...activities.map(a=>a.id)) + 1;
let editingId = null;
let reorderMode = false;
let toastTimer;
let activeRecognition = null;
let aiMode = 'demo';
let sending = false;
let chatTouched = false;
let bookingAlerts = typeof document==='undefined'?[]:readBookingAlerts();
const hongKongTime=()=>new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
let messages = [
  { role:'user', text:'我想先洗澡，再吃點東西，如果可以也幫我安排按摩。', time:hongKongTime() },
  { role:'agent', text:'好的，我會為您安排淋浴、晚餐，並視乎可用性為您預約按摩。', time:hongKongTime() },
  { role:'agent', kind:'plan', text:'行程已排好。需要預約的服務，請選擇時段並確認。', time:hongKongTime() },
  { role:'user', text:'這樣來得及登機嗎？', time:hongKongTime() },
  { role:'agent', text:'來得及。系統會按登機時間保留 10 分鐘緩衝並顯示最晚離開貴賓室的建議。', time:hongKongTime() },
  { role:'agent', kind:'opportunity', time:hongKongTime() }
];

function readSaved(){
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    if (Array.isArray(saved) && saved.every(a=>TYPES[a.type] && a.start && a.end && Number.isFinite(a.id)))
      return saved.map(a=>a.type==='gate'?{...a,locationId:'gate',venue:TYPES.gate.venue}:{...a,...ENGINE.resolveServiceLocation(a.type,a.locationId)});
  } catch (_) {}
  return DEFAULT.map(a=>({...a}));
}
function readGate(){ try { return localStorage.getItem(STORAGE+'-gate') || '25'; } catch (_) { return '25'; } }
function readArrivalTime(){try{const value=localStorage.getItem(ARRIVAL_STORAGE);return /^\d{2}:\d{2}$/.test(value||'')&&minutes(value)>=minutes('05:30')&&minutes(value)<=minutes('19:00')?value:'17:30'}catch(_){return '17:30'}}
function readBoardingTime(){try{const value=localStorage.getItem(BOARDING_STORAGE);return /^\d{2}:\d{2}$/.test(value||'')&&minutes(value)>minutes('17:30')?value:'19:20'}catch(_){return '19:20'}}
function readBookingAlerts(){try{const value=JSON.parse(localStorage.getItem(BOOKING_STORAGE));return Array.isArray(value)?value:[]}catch(_){return []}}
function readJourney(){try{const value=JSON.parse(localStorage.getItem(JOURNEY_STORAGE));return value&&typeof value.gate==='string'&&typeof value.boardingAt==='string'&&typeof value.expectedLoungeArrivalAt==='string'&&Number.isFinite(Date.parse(value.boardingAt))&&Number.isFinite(Date.parse(value.expectedLoungeArrivalAt))?value:null}catch(_){return null}}
function save(){ try { localStorage.setItem(STORAGE,JSON.stringify(activities)); localStorage.setItem(STORAGE+'-gate',gate);localStorage.setItem(ARRIVAL_STORAGE,arrivalTime);localStorage.setItem(BOARDING_STORAGE,boardingTime);localStorage.setItem(BOOKING_STORAGE,JSON.stringify(bookingAlerts));if(recoveryJourney)localStorage.setItem(JOURNEY_STORAGE,JSON.stringify(recoveryJourney)); } catch (_) {} }
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
  const walk=walkingMinutes(lastLoungeLocation());
  if(walk===null)return {scheduled:[],omitted:[...requested]};
  const gateArrival=minutes(boardingTime)-10,gateStart=gateArrival-walk;
  for(const type of requested){
    if(type==='gate'||!TYPES[type])continue;
    const end=cursor+TYPES[type].duration;
    if(end>gateStart){omitted.push(type);continue}
    scheduled.push({type,start:clock(cursor),end:clock(end),...ENGINE.resolveServiceLocation(type,TYPES[type].locationId),status:TYPES[type].reservationRequired?'pending':'added'});
    cursor=end+5;
  }
  if(scheduled.length||requested.includes('gate')) scheduled.push({type:'gate',start:clock(gateStart),end:clock(gateArrival),locationId:TYPES.gate.locationId,venue:TYPES.gate.venue,status:'none'});
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
function sorted(){ return [...activities].sort((a,b)=>ENGINE.activityTimes(a,{journey:recoveryJourney}).start-ENGINE.activityTimes(b,{journey:recoveryJourney}).start); }
function gateDeadline(){return recoveryJourney?Math.min(...[recoveryJourney.boardingAt,recoveryJourney.boardingCutoffAt].filter(Boolean).map(Date.parse))-10*60000:null;}
function hkClock(epoch){return new Date(epoch+8*3600000).toISOString().slice(11,16)}
function latestGateArrival(){return recoveryJourney?hkClock(gateDeadline()):clock(minutes(boardingTime)-10)}
function walkingMinutes(locationId,targetGate=gate){
  return TRAVEL?TRAVEL.estimate(locationId,targetGate).minutes:null;
}
function latestLoungeDeparture(locationId){const walk=walkingMinutes(locationId);return walk===null?'未知':recoveryJourney?hkClock(gateDeadline()-walk*60000):clock(minutes(boardingTime)-10-walk)}
function lastLoungeLocation(){return sorted().filter(item=>item.type!=='gate').at(-1)?.locationId||'wing'}
function availableDuration(){const walk=walkingMinutes(lastLoungeLocation());if(walk===null)return '時間待確認';const total=Math.max(0,recoveryJourney?(gateDeadline()-walk*60000-Date.parse(recoveryJourney.actualLoungeArrivalAt||recoveryJourney.expectedLoungeArrivalAt))/60000:minutes(latestLoungeDeparture(lastLoungeLocation()))-minutes(arrivalTime));return Math.floor(total/60)+'小時'+String(total%60).padStart(2,'0')+'分'}
function locationLine(itemOrType,locationId){
  const item=typeof itemOrType==='string'?{type:itemOrType,locationId:locationId||TYPES[itemOrType].locationId}:itemOrType;
  if(item.type==='gate'){const walk=walkingMinutes(lastLoungeLocation());return walk===null?'步行路線未知':('示範步行約 '+walk+' 分鐘');}
  const resolved=ENGINE.resolveServiceLocation(item.type,item.locationId);
  return resolved.venue+' · '+resolved.area;
}
function statusMarkup(item){
  if(item.type==='gate')return '';
  const labels={pending:item.waitlistEntryId?({waiting:'候補中',offered:'待接受邀請',expired:'邀請已過期',cancelled:'已退出候補'}[item.bookingState]||'待預約'):'待預約',confirmed:item.reservationId?'已預約':'示範已確認',added:'已添加',none:'已添加'};
  return '<span class="status '+esc(item.status)+'">'+(item.status==='pending'?icon('clock'):icon('check'))+esc(labels[item.status]||'已添加')+'</span>';
}
function render(){
  if(recoveryJourney){const checked=ENGINE.validateItinerary(activities,proposalPolicy());recoveryRisk=checked.valid?'':checked.errors.join(' ');}
  if(recoveryJourney){$('#planWarnings').hidden=!recoveryRisk;$('#planWarnings').textContent=recoveryRisk;}
  $('#previewStatus').textContent=recoveryRisk?'需調整行程':'已安排';
  $('#remainingText').setAttribute?.('aria-live','polite');
  const list=$('#activityList');
  list.classList.toggle('reorder-mode',reorderMode);
  list.innerHTML=sorted().map((item,index)=>{
    const type=TYPES[item.type], gateItem=item.type==='gate';
    return '<article class="activity-row" data-id="'+item.id+'"><div class="time-column"><strong>'+esc(item.start)+'</strong><span>'+esc(item.end)+'</span></div><span class="step-dot">'+(index+1)+'</span><div class="activity-detail"><div><strong>'+esc(gateItem?'前往 G'+gate+' 登機口':type.label)+'</strong></div><small>'+esc(locationLine(item))+'</small>'+statusMarkup(item)+'</div><details class="row-menu" name="activity-actions"><summary aria-label="管理'+esc(type.label)+'">'+icon('more')+'</summary><div class="row-tools"><button class="edit" type="button" data-id="'+item.id+'" aria-label="編輯'+esc(type.label)+'">'+icon('edit')+'編輯</button>'+(gateItem?'':'<button class="delete" type="button" data-id="'+item.id+'" aria-label="刪除'+esc(type.label)+'">'+icon('trash')+'移除活動</button>')+'</div></details><div class="reorder-tools"><button type="button" data-move="up" data-id="'+item.id+'" aria-label="上移">'+icon('up')+'</button><button type="button" data-move="down" data-id="'+item.id+'" aria-label="下移">'+icon('down')+'</button></div></article>';
  }).join('');
  const duration=availableDuration();
  $('#heroDuration').textContent=duration;
  $('#overviewDuration').textContent=duration;
  $('#agentDuration').textContent=duration.replace('分','分鐘');
  const departure=latestLoungeDeparture(lastLoungeLocation());
  $('#heroWindow').textContent=arrivalTime+' — '+departure;
  $('#overviewWindow').textContent=arrivalTime+' – '+departure;
  $('#activityCount').textContent=activities.filter(a=>a.type!=='gate').length;
  $('#plannerGate').textContent=gate; $('#stripGate').textContent=gate; $('#agentGate').textContent=gate;
  document.querySelectorAll('[data-boarding-time]').forEach(node=>node.textContent=boardingTime);
  const recommendation=$('#boardingRecommendation');
  if(recommendation)recommendation.textContent='建議最晚 '+departure+' 離開 '+(ENGINE.LOCATIONS[lastLoungeLocation()]?.shortName||'貴賓室')+'，'+latestGateArrival()+' 前抵達登機口';
  const pendingCount=activities.filter(a=>a.status==='pending').length;
  $('#remainingText').textContent=recoveryRisk?'行程有時間衝突，請查看調整建議':pendingCount?pendingCount+' 項服務待預約或確認':'行程已準備就緒';
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
    const data=TYPES[type], selected=activities.find(a=>a.type===type);
    const confirmed=selected?.status==='confirmed'&&Boolean(selected.reservationId), pending=Boolean(selected?.waitlistEntryId)&&['waiting','offered'].includes(selected.bookingState);
    const label=confirmed?'已預約':pending?selected.bookingState==='offered'?'待接受邀請':'候補中':data.reservationRequired?'需預約':'可直接添加';
    const displayedSlots=data.reservationRequired?(bookingUI?.get().slots||[]).filter(s=>s.service_code===type&&s.service_date===globalThis.ReservationModel?.tripDate(currentContext())).map(s=>s.start_time):data.slots.filter(time=>minutes(time)>=minutes(arrivalTime));
    return '<article class="service-card"><div class="service-photo '+esc(type)+'" aria-hidden="true"></div><div class="service-body"><div class="service-name">'+esc(data.label)+'</div><span class="service-tag '+(pending?'wait':'')+'">'+label+'</span><p>'+esc(data.locations.map(id=>ENGINE.LOCATIONS[id].shortName).join('、'))+'可選</p><div class="time-options">'+(displayedSlots.length?[...new Set(displayedSlots)].map(t=>'<span>'+t+'</span>').join(''):data.reservationRequired?'<span>查看可選時段</span>':'<span>可自訂時間</span>')+'</div><button type="button" data-service="'+type+'">'+(confirmed?'管理預約':pending?'查看候補':data.reservationRequired?'選擇時段':'添加至行程')+icon('chevron')+'</button></div></article>';
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
      else content='<div class="opportunity-inner"><div class="opportunity-copy"><strong>預約與候補</strong><p>查看可選時段、候補次序與限時邀請。</p><div class="opportunity-actions"><button data-chat="availability">查看預約與候補</button></div></div></div>';
    }
    if(m.kind==='gate') content='<div class="message-title">'+icon('plane')+'模擬登機口 G'+esc(gate)+'</div><p>請檢查最新步行約束與恢復草案，確認前原行程保持不變。</p>';
    if(m.kind==='updated') content='<div class="message-title">'+icon('check')+'行程時間已更新</div><p>請按最新登機口與候機時間檢查行程；服務預約狀態仍以實際預約系統為準。</p>';
    if(m.kind==='proposal'){
      const proposal=m.proposal;
      const changes=proposal.diff.map(change=>{
        const item=change.after||change.before;
        const label=change.kind==='added'?'新增':change.kind==='removed'?'移除':'更改';
        const time=change.kind==='updated'?change.before.start+' → '+change.after.start:item.start;
        return '<span class="proposal-change '+change.kind+'">'+esc(label)+' · '+esc(time)+' '+esc(TYPES[item.type].label)+'</span>';
      }).join('');
      const rows=[...proposal.draft].sort((a,b)=>ENGINE.activityTimes(a,proposalPolicy()).start-ENGINE.activityTimes(b,proposalPolicy()).start).map(item=>{
        const changed=proposal.diff.some(change=>change.after?.id===item.id);
        const status={confirmed:'已確認',pending:'候補／需確認',added:'已規劃',none:'出發'}[item.status]||'已規劃';
        const day=item.startAt&&recoveryJourney&&item.startAt.slice(0,10)!==recoveryJourney.plannedLoungeArrivalAt.slice(0,10)?item.startAt.slice(5,10)+' ':'';
        return '<div class="proposal-row '+(changed?'changed':'')+'"><strong>'+esc(day+item.start)+'–'+esc(item.end)+'</strong><span>'+esc(item.type==='gate'?'前往 G'+gate+' 登機口':TYPES[item.type].label)+'</span><small>'+esc(status)+'</small></div>';
      }).join('');
      const warning=proposal.warnings.length?'<div class="proposal-warnings">'+proposal.warnings.map(value=>'<p>'+esc(value)+'</p>').join('')+'</div>':'';
      const actions=proposal.status==='pending'?'<div class="proposal-actions"><button type="button" data-proposal="cancel" data-index="'+index+'">取消修改</button><button type="button" data-proposal="confirm" data-index="'+index+'">確認並保存</button></div>':'<div class="proposal-result">'+esc({confirming:'正在核对并保存…',applied:'已確認並保存',cancelled:'已取消修改',stale:'行程已變動，請重新提出修改'}[proposal.status]||'')+'</div>';
      content='<div class="message-title">'+icon('calendar')+'行程修改預覽</div><p>'+esc(proposal.explanation)+'</p><div class="proposal-changes">'+changes+'</div><div class="proposal-list">'+rows+'</div>'+warning+(proposal.error?'<p class="proposal-error">'+esc(proposal.error)+'</p>':'')+actions;
    }
    return '<div class="chat-message '+(user?'user':'agent')+' '+(m.kind||'')+'"><span class="avatar" aria-hidden="true">'+icon(user?'rest':'spark')+'</span><div class="bubble">'+content+'<time>'+esc(m.time||nowTime())+'</time></div></div>';
  }).join('');
  log.scrollTop=log.scrollHeight;
}
function nowTime(){ return hongKongTime(); }
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
  const selectedLocation=item?.locationId||data.locationId;
  showSheet(item?'編輯行程':'添加至行程','<form id="activityForm"><label class="field">活動<select id="activityType">'+Object.entries(TYPES).map(([key,t])=>'<option value="'+key+'" '+(key===type?'selected':'')+'>'+esc(t.label)+'</option>').join('')+'</select></label><div id="activityLocation">'+locationPicker(type,selectedLocation)+'</div><div class="field-row"><label class="field">開始時間<input id="activityStart" type="time" value="'+start+'" required></label><label class="field">結束時間<input id="activityEnd" type="time" value="'+end+'" required></label></div><p class="sheet-note">貴賓室及設施資料來自國泰官方介紹。淋浴和按摩需要預約；其他活動可直接加入示範行程。</p><p id="sheetError" class="sheet-error" role="alert"></p><button class="sheet-primary" type="submit">保存活動</button></form>');
}
function locationPicker(type,selectedLocation){
  const service=TYPES[type];
  if(type==='gate')return '<div class="location-card"><strong>登機口 G'+esc(gate)+'</strong><small>依目前示範航班資料顯示</small></div>';
  const ids=service.locations,selected=ids.includes(selectedLocation)?selectedLocation:service.locationId;
  return '<label class="field">貴賓室<select id="activityLounge">'+ids.map(id=>'<option value="'+id+'" '+(id===selected?'selected':'')+'>'+esc(ENGINE.LOCATIONS[id].name)+'</option>').join('')+'</select></label><div id="locationDetails" class="location-card">'+locationCard(type,selected)+'</div>';
}
function locationCard(type,locationId){
  const resolved=ENGINE.resolveServiceLocation(type,locationId),location=ENGINE.LOCATIONS[resolved.locationId];
  return '<small>實際貴賓室設施</small><strong>'+esc(location.name)+' · '+esc(resolved.area)+'</strong><span>'+esc(location.address)+'</span><a href="'+esc(location.url)+'" target="_blank" rel="noopener noreferrer">查看國泰官方介紹 ↗</a>';
}
function proposalPolicy(original=activities){return {gate,boardingTime,windowStart:arrivalTime,windowEnd:latestGateArrival(),boardingBuffer:10,walkingMinutes:walkingMinutes(lastLoungeLocation()),enforceTransfers:true,journey:recoveryJourney,originalActivities:original}}
function showArrivalSheet(){
  showSheet('修改到達時間','<form id="arrivalForm"><label class="field">到達貴賓室時間<input id="arrivalInput" type="time" min="05:30" max="19:00" value="'+esc(arrivalTime)+'" required></label><p class="sheet-note">到達時間可早於 17:30。新的活動可從到達後開始；若改為較晚到達，請先調整較早的活動。</p><p id="arrivalError" class="sheet-error" role="alert"></p><button class="sheet-primary" type="submit">保存到達時間</button></form>','行程時間');
}
function showBoardingSheet(){
  const selected=lastLoungeLocation();
  showSheet('修改登機時間','<form id="boardingForm"><label class="field">登機時間<input id="boardingInput" type="time" value="'+esc(boardingTime)+'" required></label><div id="boardingSuggestion" class="location-card"><small>系統安全建議</small><strong>最晚 '+esc(latestGateArrival())+' 抵達登機口</strong><span>從 '+esc(ENGINE.LOCATIONS[selected].shortName)+' 出發，建議最晚 '+esc(latestLoungeDeparture(selected))+' 離開；步行時間為虛構示範。</span></div><p class="sheet-note">這會產生模擬航空事件，檢查影響並預覽恢復草案；確認後才修改行程。跨午夜請使用「突發修改」的完整日期。</p><p id="boardingError" class="sheet-error" role="alert"></p><button class="sheet-primary" type="submit">檢查新的登機時間</button></form>','航班時間');
}
async function showWaitlist(type=''){
  showSheet('預約與候補','<p class="sheet-note">正在載入時段…</p>','預約管理');
  if(!bookingUI){$('#sheetBody').innerHTML='<p class="sheet-error">預約服務未載入，請透過本機服務開啟頁面。</p>';return;}
  await bookingUI.open(type);
}
// Preserve the reader's place when the reservation controller refreshes its view.
function renderBookingPanel(html){
  const sheet=$('#sheet'),panel=$('#sheetBody');
  if(!sheet.open)return;
  const focused=document.activeElement,hadFocus=panel.contains(focused);
  const action=focused?.getAttribute('data-booking'),record=focused?.getAttribute('data-record'),filter=focused?.getAttribute('data-booking-filter');
  const disclosureSlot=focused?.closest('.booking-inventory')?.dataset.slot;
  const scrollTop=sheet.scrollTop;
  const expanded=[...panel.querySelectorAll('.booking-inventory[open]')].map(node=>node.dataset.slot);
  panel.innerHTML=html;
  panel.querySelectorAll('.booking-inventory').forEach(node=>{node.open=expanded.includes(node.dataset.slot);});
  if(hadFocus){
    const target=[...panel.querySelectorAll('[data-booking], [data-booking-filter]')].find(node=>filter?node.getAttribute('data-booking-filter')===filter:action&&node.getAttribute('data-booking')===action&&node.getAttribute('data-record')===record);
    const disclosure=[...panel.querySelectorAll('.booking-inventory')].find(node=>node.dataset.slot===disclosureSlot)?.querySelector('summary');
    const fallback=panel.querySelector('[data-booking="commit"], .booking-tab[aria-pressed="true"], [data-booking="refresh"]');
    (target||disclosure||fallback)?.focus({preventScroll:true});
  }
  sheet.scrollTop=scrollTop;
}
function closeActivityMenus(except=null){
  document.querySelectorAll('.row-menu[open]').forEach(menu=>{if(menu!==except)menu.open=false;});
}
function initBookings(){
  if(!globalThis.ReservationUI)return;
  bookingUI=globalThis.ReservationUI.createController({context:()=>({...currentContext(),serviceDate:globalThis.ReservationModel.tripDate(currentContext())}),show:renderBookingPanel,update:next=>{activities=next;nextId=Math.max(nextId,...next.map(a=>a.id+1));if(recoveryJourney)recoveryJourney={...recoveryJourney,currentItinerary:next.map(a=>({...a}))};save();render();renderChat();},notify:toast});
  bookingUI.load();
  setInterval(()=>{if($('#sheet').open)bookingUI.tick();},5000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)bookingUI.load();});
}
function stageProposal(payload){
  if(!ENGINE){addMessage('agent','行程驗證模組尚未載入，請重新整理頁面。');return false}
  try{
    const original=activities.map(item=>({...item}));
    const draft=ENGINE.applyProposalToDraft(original,payload.operations,proposalPolicy(original));
    const checked=ENGINE.validateItinerary(draft,proposalPolicy(original));
    if(!checked.valid){addMessage('agent','目前無法預覽這項修改：'+checked.errors.join(' '));return false}
    const diff=ENGINE.diffItineraries(original,draft);
    if(!diff.length){addMessage('agent','行程沒有需要更改的項目。');return false}
    const proposal={operations:payload.operations.map(operation=>({...operation})),draft,diff,
      explanation:payload.explanation||'請檢查以下建議行程。',
      warnings:[...new Set([...(Array.isArray(payload.warnings)?payload.warnings:[]),...checked.warnings])],
      baseSignature:ENGINE.itinerarySignature(original,proposalPolicy(original)),recoveryPreviewId:payload.recoveryPreviewId||null,status:'pending',error:''};
    messages.push({role:'agent',kind:'proposal',text:proposal.explanation,proposal,time:nowTime()});renderChat();
    return true;
  }catch(error){addMessage('agent','無法建立安全的行程預覽：'+error.message);return false}
}
function decideProposal(index,decision){
  const entry=messages[index],proposal=entry?.proposal;
  if(!proposal||proposal.status!=='pending')return false;
  if(decision==='cancel'){
    proposal.status='cancelled';renderChat();addMessage('agent','已取消這次修改，原有行程保持不變。'+(proposal.recoveryPreviewId?' 最新航班或到達約束仍有效，請留意行程衝突。':''));return true;
  }
  if(decision!=='confirm')return false;
  if(proposal.recoveryPreviewId)return confirmRecovery(proposal);
  if(ENGINE.itinerarySignature(activities,proposalPolicy())!==proposal.baseSignature){
    proposal.status='stale';renderChat();addMessage('agent','行程已在預覽後變更。請重新提出需求，我會按最新行程產生預覽。');return false;
  }
  try{
    const draft=ENGINE.applyProposalToDraft(activities,proposal.operations,proposalPolicy());
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
  if(cursor-5>minutes(latestLoungeDeparture(lastLoungeLocation()))){ toast('時間不足，無法完成此排序。'); return; }
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
  return {...proposalPolicy(),originalActivities:undefined,flightNumber:'CX251',
    activities:sorted().map(a=>({id:a.id,type:a.type,label:TYPES[a.type].label,start:a.start,end:a.end,...(a.startAt?{startAt:a.startAt,endAt:a.endAt}:{}),status:a.status,locationId:a.locationId,venue:a.venue,area:a.area||ENGINE.resolveServiceLocation(a.type,a.locationId).area,reservationId:a.reservationId,slotId:a.slotId,waitlistEntryId:a.waitlistEntryId,bookingState:a.bookingState,loungeServiceId:a.loungeServiceId}))};
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
      messages=[{role:'agent',text:'您好，我已讀取目前的示範行程。您可以直接提出偏好或突發情況，我會根據時間安排提供建議。',time:nowTime()}];
      if(activities.some(a=>a.type==='massage'&&a.status==='pending'))messages.push({role:'agent',kind:'opportunity',time:nowTime()});
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
  if(/登機口|闸口|閘口|登機時間|登机时间/.test(text)){ addMessage('agent','目前示範登機口為 G'+gate+'，登機時間 '+boardingTime+'。建議最晚 '+latestGateArrival()+' 抵達登機口，並從 '+ENGINE.LOCATIONS[lastLoungeLocation()].shortName+' 於 '+latestLoungeDeparture(lastLoungeLocation())+' 前離開。'); return; }
  if(/比較|比较|哪個|哪个/.test(text)){ addMessage('agent','已整理寰宇堂、玉衡堂、玲瓏堂及逸連堂的設施、位置及前往 G'+gate+' 的原型步行估算。'); openCompare(); return; }
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
  if(!/如果|假如|假設|假设/.test(text)&&/晚到|遲到|迟到/.test(text)){
    const delay=text.match(/(?:晚到|遲到|迟到)\s*(\d+)\s*(?:分鐘|分钟|分)?/);
    const expected=text.match(/(?:[01]\d|2[0-3]):[0-5]\d/);
    if(delay){await runRecovery('late',delay[1]);return;}
    if(expected){const day=recoveryJourney?.plannedLoungeArrivalAt.slice(0,10)||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());await runRecovery('late',0,day+'T'+expected[0]+':00+08:00');return;}
    addMessage('agent','請提供晚到分鐘數，例如「我會晚到 20 分鐘」，或在「突發修改」輸入完整預計到達時間。');return;
  }
  if(/確認.{0,8}按摩|按摩.{0,8}確認/.test(text)){addMessage('agent','请在数据库时段页选择预约或接受邀请；最终确认后才写入本机预约。');showWaitlist('massage');return}
  if(aiMode!=='live'){demoReply(text);return}
  sending=true; $('#sendButton').disabled=true; input.disabled=true;
  const pending={role:'agent',text:'正在根據您的行程整理建議…',kind:'thinking',time:nowTime()};
  messages.push(pending); renderChat();
  try{
    const requestSignature=ENGINE.itinerarySignature(activities,proposalPolicy());
    const response=await fetch('./api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history,context:currentContext()})});
    if(!response.ok){
      const failure=await response.json().catch(()=>({}));
      throw new Error(failure.error||'AI_UNAVAILABLE');
    }
    const result=await response.json();
    messages=messages.filter(m=>m!==pending);
    if(result.type==='itinerary_proposal'){
      if(requestSignature!==ENGINE.itinerarySignature(activities,proposalPolicy()))addMessage('agent','取得 AI 建議期間行程或航班約束已變動，請重新提出需求。');
      else stageProposal(result);
    }
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
  const cards=Object.entries(ENGINE.LOCATIONS).map(([id,lounge])=>{
    const arranged=activities.filter(item=>item.locationId===id).map(item=>TYPES[item.type].label).join('、')||'尚未安排';
    return '<div class="compare-card"><h3>'+esc(lounge.name)+'</h3><p>位置：'+esc(lounge.address)+'</p><p>設施：'+esc(lounge.facilities.join('、'))+'</p><p>進入資格：'+esc(lounge.access)+'</p><p>至 G'+esc(gate)+'：原型估算約 <strong>'+walkingMinutes(id)+' 分鐘</strong></p><p>目前行程：'+esc(arranged)+'</p><a href="'+esc(lounge.url)+'" target="_blank" rel="noopener noreferrer">國泰官方介紹 ↗</a></div>';
  }).join('');
  showSheet('四個貴賓室對比','<div class="compare-grid">'+cards+'</div><p class="sheet-note">設施及位置依國泰官方貴賓室介紹整理；前往登機口時間是原型估算，並非機場即時導航。按摩只在寰宇堂及玉衡堂提供。</p>','智能建議');
}
function showRecommendations(){
  const history=readPreferenceHistory(),scores=recommendationScores(history,activities);
  const newChoices=scores.filter(item=>!activities.some(activity=>activity.type===item.type));
  const ranked=[...scores.filter(item=>activities.some(activity=>activity.type===item.type)).slice(0,2),...newChoices.slice(0,1)].slice(0,3);
  const cards=ranked.map((item,index)=>{
    const scheduled=activities.some(activity=>activity.type===item.type);
    const source=history.length?'本機過去保存記錄 '+item.personal+' 次':'目前行程偏好 '+item.personal+' 次';
    return '<div class="recommend-card"><div><span class="recommend-rank">'+(index+1)+'</span><strong>'+esc(TYPES[item.type].label)+'</strong><small>'+esc(TYPES[item.type].locations.map(id=>ENGINE.LOCATIONS[id].shortName).join('、'))+'可選</small></div><p>'+esc(source)+' · 示範群體偏好 '+item.crowd+'%</p>'+(scheduled?'<span class="recommend-added">已在行程</span>':'<button type="button" data-add-type="'+item.type+'">添加至行程</button>')+'</div>';
  }).join('');
  showSheet('智能推薦','<p class="sheet-note">依本機已保存行程的個人偏好及示範群體偏好排序。群體比例為原型樣本，並非真實所有旅客資料。</p><div class="recommend-list">'+cards+'</div>','為您推薦');
}
function openIncident(){
  showSheet('突發修改','<form id="incidentForm"><p class="sheet-note">晚到由旅客報告；航班變動由本機模擬提供者產生，並非即時航空資料。先檢查影響並預覽，確認後才保存行程。</p><label class="field">變動類型<select id="incidentType"><option value="late">我會晚到</option><option value="gate">模擬登機口變更</option><option value="delay">模擬起飛延誤</option><option value="boarding">模擬登機時間變更</option></select></label><label class="field"><span id="incidentValueLabel">晚到分鐘數</span><input id="incidentValue" value="20" required></label><label class="field">可選：完整預計到達／登機時間<input id="incidentAt" type="datetime-local"></label><p id="incidentHint" class="sheet-note">分鐘相對原计划到達時間計算，不會在上次晚到時間上累加。跨午夜請填完整日期。</p><button class="sheet-primary" type="submit">檢查影響並產生恢復建議</button></form>','突發恢復引擎');
}
async function recoveryPost(route,body){const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'RECOVERY_FAILED');return result;}
async function runRecovery(action,value,fullTime){
  if(recoveryBusy){toast('正在處理上一個突發事件，請稍候。');return false;}
  recoveryBusy=true;chatTouched=true;showScreen('agent');
  const before=ENGINE.itinerarySignature(activities,proposalPolicy());
  try{
    const data=await recoveryPost('./api/recovery',{action,value,...(fullTime?{[action==='late'?'expectedArrivalAt':'boardingAt']:fullTime}:{}),context:currentContext()});
    if(before!==ENGINE.itinerarySignature(activities,proposalPolicy())){addMessage('agent','檢查期間行程已改變，請重新模擬這次事件。');return false;}
    if(data.impact.eventStatus==='rejected'){addMessage('agent','事件未接受：'+data.impact.eventErrors.join(' '));return false;}
    recoveryJourney=data.state;arrivalTime=data.state.expectedLoungeArrivalAt.slice(11,16);boardingTime=data.state.boardingAt.slice(11,16);gate=data.state.gate;
    messages.forEach(message=>{if(message.proposal?.status==='pending')message.proposal.status='stale';});
    const facts={late:'旅客預計到達 '+arrivalTime,gate:'模擬登機口改為 G'+gate,delay:'模擬起飛估計 '+data.state.estimatedDepartureAt.slice(11,16)+'；登機時間未自動延後',boarding:'模擬登機時間改為 '+boardingTime};
    addMessage('agent',(facts[action]||'旅程資料更新')+'。原行程尚未修改。','system');
    save();render();
    if(data.proposal)stageProposal({...data.proposal,recoveryPreviewId:data.previewId});
    else addMessage('agent',data.result.explanation,'system');
    if(aiMode==='live'){
      const revision=recoveryJourney.revision;
      try{const explanation=await recoveryPost('./api/recovery/explain',{previewId:data.previewId});if(recoveryJourney.revision===revision)addMessage('agent',explanation.reply);}
      catch(_){addMessage('agent','DeepSeek 暫時無法解釋這次建議；恢復引擎的校驗與草案仍可使用。');}
    }
    return true;
  }catch(error){addMessage('agent','無法處理這次突發事件，請檢查分鐘、登機口或日期。原行程保持不變。');return false;}
  finally{recoveryBusy=false;}
}
async function confirmRecovery(proposal){
  if(proposal.status!=='pending')return false;
  if(ENGINE.itinerarySignature(activities,proposalPolicy())!==proposal.baseSignature){proposal.status='stale';renderChat();return false;}
  proposal.status='confirming';renderChat();
  try{
    const result=await recoveryPost('./api/recovery/confirm',{previewId:proposal.recoveryPreviewId,context:currentContext()});
    if(ENGINE.itinerarySignature(activities,proposalPolicy())!==proposal.baseSignature)throw new Error('STALE_RECOVERY');
    const checked=ENGINE.validateItinerary(result.draft,proposalPolicy());if(!checked.valid)throw new Error('INVALID_RECOVERY');
    activities=result.draft;recoveryJourney={...recoveryJourney,currentItinerary:activities.map(item=>({...item})),revision:recoveryJourney.revision+1};
    nextId=Math.max(nextId,...activities.map(item=>item.id+1));
    bookingAlerts=[...new Set([...bookingAlerts,...result.warnings])].slice(-8);
    proposal.status='applied';save();render();renderChat();
    addMessage('agent','已確認並保存恢復行程。實際預約未自動取消或確認；改期服務仍需另行確認。');return true;
  }catch(error){proposal.status='stale';proposal.error=error.message==='RECOVERY_SLOT_CHANGED'?'空位已變動，請重新產生草案。':'旅程或草案已失效，請重新提出突發修改。';renderChat();return false;}
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
  $('#changeBoarding').addEventListener('click',showBoardingSheet);
  $('#closeSheet').addEventListener('click',()=>{bookingUI?.close();closeSheet();});
  $('#sheet').addEventListener('close',()=>{if(!$('#sheet').open)bookingUI?.close();});
  $('#activityList').addEventListener('click',e=>{
    const edit=e.target.closest('button.edit'), del=e.target.closest('button.delete'), move=e.target.closest('[data-move]');
    if(edit||del)closeActivityMenus();
    if(edit)openEdit(activities.find(a=>a.id===Number(edit.dataset.id)));
    if(del){const item=activities.find(a=>a.id===Number(del.dataset.id));if(item?.reservationId&&bookingUI?.get().reservations.some(r=>r.id===item.reservationId&&r.status==='confirmed')||item?.waitlistEntryId&&bookingUI?.get().waitlist.some(w=>w.id===item.waitlistEntryId&&['waiting','offered'].includes(w.status))){showWaitlist();toast('請先取消預約或退出候補，再移除活動。');return;}activities=activities.filter(a=>a.id!==Number(del.dataset.id));render();renderChat();save();toast('活動已從行程移除。')}
    if(move)reorder(Number(move.dataset.id),move.dataset.move);
  });
  $('#activityList').addEventListener('toggle',event=>{
    const menu=event.target;
    if(!menu.matches?.('.row-menu'))return;
    menu.classList.remove('opens-up');
    if(!menu.open)return;
    closeActivityMenus(menu);
    const tools=menu.querySelector('.row-tools'),viewport=$('.planner-content').getBoundingClientRect();
    if(tools.getBoundingClientRect().bottom>viewport.bottom-8)menu.classList.add('opens-up');
  },true);
  $('.planner-content').addEventListener('scroll',()=>closeActivityMenus(),{passive:true});
  document.addEventListener?.('click',event=>{if(!event.target.closest('.row-menu'))closeActivityMenus();});
  document.addEventListener?.('keydown',event=>{
    if(event.key!=='Escape')return;
    const open=document.querySelector('.row-menu[open]');
    if(open){event.preventDefault();closeActivityMenus();open.querySelector('summary').focus();}
  });
  $('#reorderButton').addEventListener('click',()=>{reorderMode=!reorderMode;render();$('#reorderButton').innerHTML=icon('arrows')+(reorderMode?' 完成排序':' 重新排序')});
  $('#serviceList').addEventListener('click',e=>{const b=e.target.closest('[data-service]');if(!b)return;if(TYPES[b.dataset.service].reservationRequired)showWaitlist(b.dataset.service);else openEdit(null,b.dataset.service)});
  $('#changeTime').addEventListener('click',()=>showSheet('修改時間','<p class="sheet-note">可修改到達時間、登機時間或每項活動。系統會重新計算最晚離開貴賓室的建議。</p><button class="sheet-choice" data-arrival="open"><strong>到達貴賓室　'+esc(arrivalTime)+'</strong><small>修改候機時段起點</small></button><button class="sheet-choice" data-boarding="open"><strong>登機時間　'+esc(boardingTime)+'</strong><small>查看並套用最晚抵達登機口建議</small></button>'+sorted().map(a=>'<button class="sheet-choice" data-edit-id="'+a.id+'"><strong>'+esc(a.start)+' – '+esc(a.end)+'　'+esc(TYPES[a.type].label)+'</strong><small>'+esc(locationLine(a))+'</small></button>').join('')));
  $('#savePlan').addEventListener('click',()=>{save();recordPreferenceSnapshot();toast('行程已保存在此裝置。')});
  $('#viewWaitlist').addEventListener('click',showWaitlist);
  $('#viewAll').addEventListener('click',()=>showSheet('所有可添加行程',Object.entries(TYPES).filter(([key])=>key!=='gate').map(([key,t])=>'<button class="sheet-choice" data-add-type="'+key+'"><strong>'+esc(t.label)+'</strong><small>'+esc(t.locations.map(id=>ENGINE.LOCATIONS[id].shortName).join('、'))+'可選　·　約 '+t.duration+' 分鐘</small></button>').join(''),'探索服務'));
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
    const booking=e.target.closest('[data-booking]');if(booking){bookingUI?.action(booking.dataset.booking,Number(booking.dataset.record));return;}
    const edit=e.target.closest('[data-edit-id]'),add=e.target.closest('[data-add-type]'),action=e.target.closest('[data-sheet]'),incident=e.target.closest('[data-incident]'),arrival=e.target.closest('[data-arrival]'),boarding=e.target.closest('[data-boarding]');
    if(arrival){closeSheet();showArrivalSheet()}
    if(boarding){closeSheet();showBoardingSheet()}
    if(edit){closeSheet();openEdit(activities.find(a=>a.id===Number(edit.dataset.editId)))}
    if(add){closeSheet();openEdit(null,add.dataset.addType)}
    if(action){closeSheet();showScreen('agent')}
  });
  $('#sheetBody').addEventListener('change',e=>{
    if(e.target.dataset.bookingFilter){bookingUI?.filter(e.target.dataset.bookingFilter,e.target.value);return;}
    if(e.target.id==='incidentType'){const options={late:['20','晚到分鐘數'],gate:['65','新的登機口'],delay:['30','起飛延誤分鐘數'],boarding:[boardingTime,'新的登機時間（HH:MM）']};const selected=options[e.target.value];$('#incidentValue').value=selected[0];$('#incidentValueLabel').textContent=selected[1];$('#incidentAt').value='';$('#incidentAt').disabled=!['late','boarding'].includes(e.target.value);$('#incidentHint').textContent=e.target.value==='delay'?'起飛延誤不會自動延後登機時間。':e.target.value==='gate'?'步行時間來自虚構路线表；未知登機口不會猜測距離。':'跨午夜可填完整日期；所有修改仍需確認。';}
    if(e.target.id==='activityType')$('#activityLocation').innerHTML=locationPicker(e.target.value,TYPES[e.target.value].locationId);
    if(e.target.id==='activityLounge')$('#locationDetails').innerHTML=locationCard($('#activityType').value,e.target.value);
    if(e.target.id==='boardingInput'){
      const value=e.target.value,selected=lastLoungeLocation();
      if(/^\d{2}:\d{2}$/.test(value))$('#boardingSuggestion').innerHTML='<small>系統安全建議</small><strong>最晚 '+esc(clock(minutes(value)-10))+' 抵達登機口</strong><span>'+esc(walkingMinutes(selected)===null?'步行路線未知，不能推算安全離開時間。':'從 '+ENGINE.LOCATIONS[selected].shortName+' 出發，建議最晚 '+clock(minutes(value)-10-walkingMinutes(selected))+' 離開；步行時間為虛構示範。')+'</span>';
    }
    if(e.target.id==='activityType'||e.target.id==='activityStart'){
      const start=$('#activityStart').value;
      if(/^\d{2}:\d{2}$/.test(start))$('#activityEnd').value=clock(minutes(start)+TYPES[$('#activityType').value].duration);
    }
  });
  $('#sheetBody').addEventListener('submit',e=>{
    if(e.target.id==='incidentForm'){e.preventDefault();const action=$('#incidentType').value,value=$('#incidentValue').value,raw=$('#incidentAt').value;closeSheet();runRecovery(action,value,raw?raw+(raw.length===16?':00':'')+'+08:00':undefined);return;}
    if(e.target.id==='arrivalForm'){
      e.preventDefault();
      const proposed=$('#arrivalInput').value;
      if(!/^\d{2}:\d{2}$/.test(proposed)||minutes(proposed)<minutes('05:30')||minutes(proposed)>minutes('19:00')){$('#arrivalError').textContent='請選擇 05:30 至 19:00 之間的時間。';return}
      const nextJourney=recoveryJourney?{...recoveryJourney,plannedLoungeArrivalAt:recoveryJourney.expectedLoungeArrivalAt.slice(0,10)+'T'+proposed+':00+08:00',expectedLoungeArrivalAt:recoveryJourney.expectedLoungeArrivalAt.slice(0,10)+'T'+proposed+':00+08:00',revision:recoveryJourney.revision+1}:null;
      const checked=ENGINE.validateItinerary(activities,{...proposalPolicy(),windowStart:proposed,journey:nextJourney});
      if(!checked.valid){$('#arrivalError').textContent=checked.errors[0]+' 請先調整較早的活動。';return}
      arrivalTime=proposed;if(nextJourney)recoveryJourney=nextJourney;save();render();closeSheet();toast('到達時間已更新，可安排較早的活動。');return;
    }
    if(e.target.id==='boardingForm'){
      e.preventDefault();
      const proposed=$('#boardingInput').value;
      if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(proposed)){$('#boardingError').textContent='請輸入有效登機時間。';return}
      closeSheet();runRecovery('boarding',proposed);return;
    }
    if(e.target.id!=='activityForm')return;e.preventDefault();
    const type=$('#activityType').value;
    const previous=activities.find(a=>a.id===editingId);
    const locationId=type==='gate'?'gate':$('#activityLounge').value;
    const candidate={...(previous?{reservationId:previous.reservationId,waitlistEntryId:previous.waitlistEntryId,slotId:previous.slotId,bookingState:previous.bookingState}:{}),id:editingId??nextId,type,start:$('#activityStart').value,end:$('#activityEnd').value,...ENGINE.resolveServiceLocation(type,locationId),status:type==='gate'?'none':TYPES[type].reservationRequired?'pending':'added'};
    if(previous)candidate.status=previous.type===type&&previous.start===candidate.start&&previous.end===candidate.end&&previous.locationId===candidate.locationId?previous.status:previous.status==='confirmed'?'pending':candidate.status;
    const err=validate(candidate);if(err){$('#sheetError').textContent=err;return}
    if(editingId)activities=activities.map(a=>a.id===editingId?candidate:a);else{activities.push(candidate);nextId++}
    closeSheet();render();toast(editingId?'行程已更新。':'活動已加入行程。');
  });
  setupVoice();render();renderChat();checkAgentMode();initBookings();
}
if(typeof module!=='undefined')module.exports={parseTypes,planActivities,voiceErrorMessage};
