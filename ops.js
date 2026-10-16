/* Native browser UI; all reservation figures originate in /api/ops/state. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sum=values=>values.reduce((a,b)=>a+b,0);
  const paths={home:'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',chart:'M3 19 9 12l4 3 8-11M16 4h5v5',people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4',calendar:'M4 5h16v16H4zM8 2v6M16 2v6M4 10h16M8 15l3 3 5-5',clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 3',list:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h6',layers:'m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6',plane:'m2 13 8-3 7-8 3 1-5 9 7 4-1 2-9-2-5 6-2-1 2-7-5 1z',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3 1 4-5 3-3-3-4 1-3-5 3-3-1-4z'};
  const icon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.list}"/></svg>`;
  const titles={overview:'運營概覽',traffic:'客流預測',staff:'人力資源',bookings:'預約處理'};
  const statuses={waiting:'候補中',offered:'待確認邀請',accepted:'已接受邀請',expired:'邀請已過期',cancelled:'已取消',confirmed:'已確認',completed:'已完成',no_show:'未到訪'};
  const tiers={first:'頭等資格',business:'商務資格',diamond:'鑽石資格',gold:'金卡資格',standard:'普通資格'};
  const serviceNames={shower:'淋浴',massage:'按摩',rest:'休息／日間套房',work:'工作空間',dining:'用餐'};
  const errors={INVALID_INPUT:'輸入資料無效，請核對日期、服務時長、容量與旅客編號。',SLOT_FULL:'名額已滿或已由邀請保留。',ALREADY_RESERVED:'此旅客已有相同時段的預約。',NOT_ELIGIBLE:'旅客不符合此示範服務的資格。',SLOT_AVAILABLE:'尚有名額，請建立預約。',WAITLIST_OFFER_PENDING:'此旅客已有邀請，請接受或拒絕該邀請。',OFFER_EXPIRED:'邀請已過期，請重新加入候補。',OFFER_NOT_AVAILABLE:'目前沒有可接受的邀請。',INVALID_WAITLIST_STATE:'候補狀態已改變，請重新查詢。',INVALID_RESERVATION_STATE:'此預約目前不能取消。',SLOT_INACTIVE:'此時段已停用。',USER_NOT_FOUND:'找不到所選旅客。',SLOT_NOT_FOUND:'找不到所選時段。',RESERVATION_NOT_FOUND:'找不到此預約。',FORBIDDEN:'旅客與記錄不符。',DATABASE_BUSY:'資料庫忙碌，請以同一操作重試。',IDEMPOTENCY_CONFLICT:'操作識別碼與原請求不同，請返回重新操作。'};
  let data=null,page='overview',busy=false,loading=false,pending=null,selectedSlot=null;
  let filters={lounge:'',service:'',forecast:''},manual={user:1,search:'',lounge:'',service:'',slot:'',reservation:''};
  let date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const user=id=>data.users.find(u=>u.id===Number(id));
  const lounge=id=>data.lounges.find(l=>l.lounge_id===Number(id));
  const slot=id=>data.slots.find(s=>s.slot_id===Number(id));
  const slotLabel=s=>s?`${lounge(s.lounge_id)?.display_name||'未分類'} · ${s.display_name} · ${s.start_time}–${s.end_time}`:'時段資料不可用';
  const formatAt=at=>at?new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at)):'—';
  const stateBadge=(text,tone='green')=>`<span class="status ${tone}"><span class="dot"></span>${esc(text)}</span>`;
  const button=(label,action,id='',tone='small-button',disabled=false)=>`<button class="${tone}" data-action="${action}" data-id="${esc(id)}" ${disabled?'disabled':''}>${esc(label)}</button>`;
  const options=(items,value,placeholder)=>`${placeholder?`<option value="">${esc(placeholder)}</option>`:''}${items.map(([id,name])=>`<option value="${esc(id)}" ${String(id)===String(value)?'selected':''}>${esc(name)}</option>`).join('')}`;
  const panel=(title,name,body,extra='')=>`<section class="panel"><div class="panel-head"><h3>${icon(name)}${esc(title)}</h3>${extra}</div>${body}</section>`;
  const card=(title,value,unit,name,note='',text=false)=>`<article class="kpi"><div class="round">${icon(name)}</div><div><h3>${esc(title)}</h3><strong class="${text?'text-value':''}">${esc(value)}</strong><em>${esc(unit)}</em>${note?`<small>${esc(note)}</small>`:''}</div></article>`;
  const table=(heads,body,foot='')=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${heads.length}" class="empty">目前沒有符合條件的記錄。</td></tr>`}</tbody>${foot?`<tfoot>${foot}</tfoot>`:''}</table></div>`;
  const cells=values=>'<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,4200);}
  async function request(route,method='GET',body){
    let response;
    try{response=await fetch(route,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Ops-Request':'1'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}
    catch(_){throw Error('連線中斷；操作結果可在重新同步後核對。預約重試會使用同一識別碼。');}
    const result=await response.json();
    if(!response.ok){const error=Error(errors[result.error?.code]||result.error?.message||'讀取失敗，請重試。');error.code=result.error?.code;throw error;}
    return result.data;
  }
  function filteredSlots(){return data.slots.filter(s=>(!filters.lounge||String(s.lounge_id)===filters.lounge)&&(!filters.service||s.service_code===filters.service));}
  function overview(){
    const a=data.analytics,s=a.summary;
    const full=data.slots.filter(s=>s.active&&!s.direct_bookable).length;
    const demand=[...a.rows].sort((x,y)=>sum(y.periods.map(p=>p.total))-sum(x.periods.map(p=>p.total)))[0];
    const movement=a.transfers[0];
    const notes=[`預測到訪高峰為 ${a.peak.hour}:00–${a.peak.hour+1}:00，合計 ${a.peak.total} 人次。`,s.waiting?`目前 ${s.waiting} 位旅客候補中，共 ${s.waitingEntries} 筆候補。`:'目前沒有旅客等待候補。',movement?`建議由${movement.fromName}調派 ${movement.count} 人支援${movement.toName}。`:`${demand?.name||'各堂'}的預測需求較高；請核對人力頁建議。`];
    const body=a.rows.map(r=>cells([esc(r.name),`${r.currentOccupancy} 人`,stateBadge('示範運作中')])).join('');
    const tasks=[];
    if(s.offered)tasks.push(`<div class="task"><span><span class="dot"></span>${s.offered} 件邀請等待旅客確認</span>${button('處理','navigate','bookings')}</div>`);
    if(s.waiting)tasks.push(`<div class="task"><span><span class="dot"></span>${s.waitingEntries} 筆候補可查看排名及邀請</span>${button('查看','navigate','bookings')}</div>`);
    if(a.transfers.length)tasks.push(`<div class="task"><span><span class="dot"></span>${a.transfers.length} 項一般支援調動建議</span>${button('查看','navigate','staff')}</div>`);
    if(!tasks.length)tasks.push('<p class="empty">目前沒有待處理預約事項。</p>');
    return `<div class="cards">${card('目前在場人數',s.occupancy,'人','people','合成情境 · 16:00 在場快照')}${card('今日已確認預約',s.confirmed,'件','calendar','所選日期 · 已確認服務預約')}${card('候補中顧客',s.waiting,'人','people','只計等待中，跨時段按旅客去重')}${card('服務狀態',full?'需關注':'正常','','settings',full?`${full} 個時段已滿或保留名額`:'以可用預約庫存判定',true)}</div><div class="grid3">${panel('今日重點','list',`<ol class="number-list">${notes.map(n=>`<li><div>${esc(n)}</div></li>`).join('')}</ol>`)}${panel('各堂狀態','layers',table(['貴賓室及艙等','目前在場','狀態'],body,cells(['合計',s.occupancy+' 人','合成快照']))) }${panel('待處理事項','clock',tasks.join(''))}</div>`;
  }
  function lineChart(periods){
    const max=Math.max(5,Math.ceil(Math.max(...periods.map(p=>p.total))/5)*5),left=46,top=25,width=640,height=215;
    const x=i=>left+i*width/3,y=n=>top+height-n/max*height;
    let svg='';
    for(let i=0;i<=4;i++){const n=max*i/4;svg+=`<line x1="${left}" x2="${left+width}" y1="${y(n)}" y2="${y(n)}" stroke="#e7eef3"/><text x="${left-10}" y="${y(n)+4}" text-anchor="end">${Number(n.toFixed(1))}</text>`;}
    for(const [key,color,dash]of [['known','#2889d2',''],['total','#098e68','7 5']]){
      svg+=`<polyline points="${periods.map((p,i)=>x(i)+','+y(p[key])).join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-dasharray="${dash}"/>`;
      periods.forEach((p,i)=>{svg+=`<circle cx="${x(i)}" cy="${y(p[key])}" r="4" fill="${color}"><title>${p.hour}:00–${p.hour+1}:00 · ${key==='known'?'已知需求':'含臨時到訪'} ${p[key]} 人次</title></circle><text x="${x(i)}" y="${y(p[key])+(key==='known'?19:-12)}" text-anchor="middle">${p[key]}</text>`;});
    }
    svg+=periods.map((p,i)=>`<text x="${x(i)}" y="270" text-anchor="middle">${p.hour}:00–${p.hour+1}:00</text>`).join('');
    return `<svg class="chart" viewBox="0 0 730 295" role="img" aria-label="每小時預測到訪人次，實線為已知需求，虛線為含臨時到訪總需求">${svg}</svg>`;
  }
  function traffic(){
    const a=data.analytics,rows=a.rows.filter(r=>!filters.forecast||String(r.loungeId)===filters.forecast);
    const periods=a.totals.map((p,i)=>({...p,known:sum(rows.map(r=>r.periods[i].known)),temporary:sum(rows.map(r=>r.periods[i].temporary)),total:sum(rows.map(r=>r.periods[i].total))}));
    const totalKnown=sum(periods.map(p=>p.known)),temporary=sum(periods.map(p=>p.temporary));
    const peak=periods.reduce((a,b)=>b.total>a.total?b:a,periods[0]);
    const highest=[...rows].sort((x,y)=>sum(y.periods.map(p=>p.total))-sum(x.periods.map(p=>p.total)))[0];
    const select=`<label class="muted">圖表與表格範圍 <select id="forecastLounge">${options(data.lounges.map(l=>[l.lounge_id,l.display_name]),filters.forecast,'全部貴賓室')}</select></label>`;
    const forecastTable=table(['貴賓室／艙等',...a.totals.map(p=>p.hour+':00')],rows.map(r=>cells([esc(r.name),...r.periods.map(p=>p.total)])).join(''),cells(['總到訪人次',...periods.map(p=>p.total)])+cells(['其中已知需求',...periods.map(p=>p.known)]));
    const flights=table(['航班','類型／航線','原定 → 預計','相關貴賓室','需求依據'],data.flights.map(f=>cells([f.number,`${f.direction==='arrival'?'抵港轉機':'離港'}<br><span class="muted">${esc(f.route)}</span>`,`${formatAt(f.scheduledAt)}<br>→ ${formatAt(f.estimatedAt)}`,esc(lounge(f.loungeId)?.display_name),`${f.eligiblePassengers} 位合資格旅客 × ${Math.round(f.visitProbability*100)}%<br><span class="muted">先扣除已有預約旅客</span>`])).join(''));
    return `<div class="cards">${card('已知到訪需求',totalKnown,'人次','people','16:00–20:00 · 服務預約推算並去重')}${card('預測臨時到訪',temporary,'人次','chart','16:00–20:00 · 合成航班推算')}${card('預計高峰時段',peak.hour+':00–'+(peak.hour+1)+':00','','clock',`預測到訪 ${peak.total} 人次`,true)}${card('需求最高的貴賓室',highest?.name||'無資料','','layers','按所選四小時到訪合計',true)}</div><div class="grid2"><div class="stack">${panel('整體客流預測','chart',`<div class="legend"><span><i></i>已知需求</span><span><i class="dashed"></i>含臨時到訪</span></div>${lineChart(periods)}<p class="caption">單位：每小時到訪人次。懸停資料點可查看數值。${select}</p>`)}${panel('預測依據與情境','list',`<ol class="number-list"><li><div>已確認預約按「旅客＋貴賓室」合併為一次到訪。<small>同一旅客多項活動不會重複計為多位旅客。</small></div></li><li><div>臨時到訪＝未計入預約的合資格航班旅客 × 到訪機率。<small>離港旅客提早 120 分鐘到訪；轉機旅客抵港後 30 分鐘到訪；典型停留 90 分鐘。</small></div></li><li><div>以每小時中點估算在場需求，用於人力計算。<small>預測在場人數受示範貴賓室容量限制；到訪人次與目前在場人數分開呈現。</small></div></li></ol><div class="flight-controls"><label for="flightNumber">模擬航班</label><select id="flightNumber">${options(data.flights.map(f=>[f.number,f.number]),'CX251')}</select><label for="flightMinutes">延誤分鐘</label><input id="flightMinutes" type="number" min="0" max="180" value="30">${button('更新情境','flight','','secondary')}</div><p class="caption">延誤相對原定時間計算，0 代表復原。不自動更改旅客登機時間或行程。</p>`)} </div><div class="stack">${panel('各堂預測概覽','list',forecastTable+'<p class="caption">欄位為每小時區間起點，單位：到訪人次；合計與左圖虛線一致。</p>')}${panel('航班導流參考','plane',flights+'<p class="caption">CX251 的基準沿用現有恢復引擎；其餘航班及合資格人數為合成情境。沒有連接國泰航班 API。</p>')}</div></div>`;
  }
  const colors=['#55aadd','#65c7ac','#f5bf50','#f3a575','#9d8ed3','#77cfe1'];
  function staffChart(rows,totals){
    const max=Math.max(5,...totals.map(t=>t.required)),scale=185/max;
    let svg='';
    for(let i=0;i<=4;i++){const v=Math.ceil(max/4*i);svg+=`<line x1="45" x2="650" y1="${225-v*scale}" y2="${225-v*scale}" stroke="#e7eef3"/><text x="32" y="${229-v*scale}" text-anchor="end">${v}</text>`;}
    totals.forEach((p,i)=>{let y=225;rows.forEach((r,j)=>{const count=r.periods[i].required,h=count*scale;y-=h;svg+=`<rect x="${85+i*145}" y="${y}" width="65" height="${h}" fill="${colors[j%colors.length]}"><title>${esc(r.name)} ${p.hour}:00 需求 ${count} 人</title></rect>`;});svg+=`<text x="${117+i*145}" y="${y-10}" text-anchor="middle">${p.required}</text><text x="${117+i*145}" y="255" text-anchor="middle">${p.hour}:00–${p.hour+1}:00</text>`;});
    return `<svg class="chart" viewBox="0 0 700 280" role="img" aria-label="未來四小時各堂預計人力需求">${svg}</svg><div class="bar-legend">${rows.map((r,i)=>`<span><b style="background:${colors[i%colors.length]}"></b>${esc(r.name)}</span>`).join('')}</div>`;
  }
  function staff(){
    const a=data.analytics,index=a.totals.findIndex(t=>t.hour===a.staffPeak.hour);
    const rows=a.rows.map(r=>{const required=r.periods[index].required,diff=required-r.currentStaff;return cells([esc(r.name),r.currentStaff+' 人',required+' 人',`<span class="${diff>0?'red':diff<0?'green':''}">${diff>0?'+':''}${diff} 人</span>`,`<span class="badge ${diff>0?'danger':''}">${diff>0?'建議增派 '+diff+' 人':diff<0?'可調出 '+(-diff)+' 人':'維持現狀'}</span>`]);}).join('');
    const moves=a.transfers.map(m=>`<li><div>由${esc(m.fromName)}調派 ${m.count} 人至${esc(m.toName)}<small>${m.role} · 依高峰需求差額推算，建議尚未套用。</small></div></li>`).join('')||'<li><div>目前沒有可由餘裕人手配對的調動。<small>缺額不會自動以新增員工填平。</small></div></li>';
    const columns=['貴賓室',...a.totals.map(t=>t.hour+':00–'+(t.hour+1)+':00')];
    const shifts=table(columns,a.rows.map(r=>cells([esc(r.name),...a.totals.map(()=>r.currentStaff)])).join(''),cells(['當值合計',...a.totals.map(()=>a.summary.rostered)]));
    const demand=table(columns,a.rows.map(r=>cells([esc(r.name),...r.periods.map(p=>p.required)])).join(''),cells(['需求合計',...a.totals.map(p=>p.required)]));
    const cards=card('今日排班人數',a.summary.rostered,'人','people','合成排班 · 本情境全員於 16:00 當值')+card('高峰時段需求',a.staffPeak.hour+':00–'+(a.staffPeak.hour+1)+':00','','calendar',`預計需要 ${a.staffPeak.required} 人`,true)+card('建議調動區域',new Set(a.transfers.flatMap(m=>[m.from,m.to])).size,'處','people','依可調出與缺額配對')+card('整體人力狀態',a.unfilled?'需補充':a.transfers.length?'可優化':'平衡','','settings',a.unfilled?`內部調動後仍有 ${a.unfilled} 人缺額`:'總人數不因建議而自動增加',true);
    const demandPanel=panel('時段排班概覽','clock','<p class="caption">下表為預計需求，與長條圖一致。</p>'+demand+'<details><summary>查看示範班次實際當值人手</summary>'+shifts+'<p class="caption">本示範為 16:00–20:00 同一班次，建議調動尚未套用。</p></details>');
    return `<div class="cards">${cards}</div><div class="grid2"><div class="stack">${panel('各堂人力需求','list',table(['貴賓室','目前人手','預計需求','差額','建議'],rows,cells(['合計',a.summary.rostered+' 人',a.staffPeak.required+' 人',(a.staffPeak.required-a.summary.rostered)+' 人','高峰時段'])))}${panel('未來四小時人力需求','chart',staffChart(a.rows,a.totals))}</div><div class="stack">${demandPanel}${panel('調度建議','list',`<ol class="number-list">${moves}</ol><p class="caption">規則：預測在場人數／示範服務比率（向上取整）＋已預約按摩的專項需求，再取最低人手與計算值的較大者。只調動一般支援，專項需求不由接待人員替代。</p>${button('檢視需求來源','navigate','traffic','secondary')}`)}</div></div>`;
  }
  function queueTable(entries,compact=false){
    return table(['旅客','服務／時段','排名','狀態／到期','操作'],entries.map(w=>{
      const s=slot(w.service_slot_id);
      const actions=w.status==='waiting'?button('移除','leave',w.id):w.status==='offered'?button('代確認接受','accept',w.id)+button('拒絕','leave',w.id):'—';
      return cells([esc(user(w.user_id)?.display_name||'旅客 '+w.user_id),esc(slotLabel(s)),w.status==='waiting'?w.position:w.status==='offered'?'已獲邀':'—',`${stateBadge(statuses[w.status]||w.status,w.status==='offered'?'amber':w.status==='waiting'?'teal':'green')}${w.offer_expires_at?'<br><small class="muted">'+formatAt(w.offer_expires_at)+'</small>':''}`,`<div class="actions">${actions}</div>`]);
    }).join(''));
  }
  function bookingRows(records){return table(['預約編號','旅客','服務／時段','狀態','操作'],records.map(r=>cells([r.id,esc(user(r.user_id)?.display_name),esc(slotLabel(slot(r.service_slot_id))),esc(statuses[r.status]),r.status==='confirmed'?button('取消預約','cancel',r.id):'—'])).join(''));}
  function bookings(){
    const s=data.analytics.summary,slots=filteredSlots();
    const matching=new Set(slots.map(s=>s.slot_id));
    const records=data.reservations.filter(r=>matching.has(r.service_slot_id)&&r.status==='confirmed');
    const queue=data.waitlist.filter(w=>matching.has(w.service_slot_id)&&['waiting','offered'].includes(w.status));
    const tool=`<div class="toolbar"><label>貴賓室<select id="loungeFilter">${options(data.lounges.map(l=>[l.lounge_id,l.display_name]),filters.lounge,'全部貴賓室')}</select></label><label>服務<select id="serviceFilter">${options(Object.entries(serviceNames),filters.service,'全部服務')}</select></label>${button('新增時段','new-slot','','secondary')}${button('重建示範情境','reset','','secondary')}</div>`;
    const rows=slots.map(s=>cells([esc(s.display_name),esc(lounge(s.lounge_id)?.display_name),`${s.start_time}–${s.end_time}`,s.capacity,`${s.confirmed_count}<small class="muted"> ＋保留 ${s.held}${s.occupied>s.confirmed_count?" ＋歷史佔用 "+(s.occupied-s.confirmed_count):""}</small>`,s.queue_count,stateBadge(!s.active?'已停用':s.direct_bookable?'可預約':s.held?'邀請保留中':'已滿',!s.active?'red':s.direct_bookable?'green':'amber'),button('查看','detail',s.slot_id)])).join('');
    const foot=cells(['合計',slots.length+' 個時段','所選篩選',sum(slots.map(s=>s.capacity)),`${sum(slots.map(s=>s.confirmed_count))} ＋保留 ${sum(slots.map(s=>s.held))}`,sum(slots.map(s=>s.queue_count)),'—','—']);
    const users=data.users.filter(u=>!manual.search||u.display_name.includes(manual.search)||String(u.id).includes(manual.search));
    const services=data.catalog.filter(c=>(!manual.lounge||String(c.lounge_id)===manual.lounge)&&c.reservation_mode!=='walk_in');
    const choices=data.slots.filter(s=>s.active&&(!manual.lounge||String(s.lounge_id)===manual.lounge)&&(!manual.service||s.service_code===manual.service));
    const own=data.reservations.filter(r=>r.user_id===Number(manual.user)&&r.status==='confirmed');
    const manualPanel=`<div class="form-grid"><label for="userSearch">搜尋旅客</label><input id="userSearch" placeholder="姓名或既有旅客編號" value="${esc(manual.search)}"><label for="manualUser">示範旅客</label><select id="manualUser">${options(users.map(u=>[u.id,u.display_name+' · '+tiers[u.membership_tier]]),manual.user)}</select><label for="manualLounge">貴賓室</label><select id="manualLounge">${options(data.lounges.map(l=>[l.lounge_id,l.display_name]),manual.lounge,'全部貴賓室')}</select><label for="manualService">服務</label><select id="manualService">${options([...new Map(services.map(c=>[c.service_code,c.display_name])).entries()],manual.service,'全部可預約服務')}</select><label for="manualSlot">預約時段</label><select id="manualSlot">${options(choices.map(s=>[s.slot_id,slotLabel(s)]),manual.slot,'請選擇時段')}</select><div class="full actions">${button('新增預約','manual-book','','primary',!manual.slot)}${button('加入候補','manual-join','','secondary',!manual.slot)}</div><label for="manualReservation">現有預約</label><select id="manualReservation">${options(own.map(r=>[r.id,'#'+r.id+' '+slotLabel(slot(r.service_slot_id))]),manual.reservation,'請選擇要取消的預約')}</select><div class="full actions">${button('取消所選預約','manual-cancel','','danger-button',!manual.reservation)}</div><p class="caption full">只可選擇資料庫現有旅客。代辦仍檢查會員資格、庫存及已有預約重疊；未取得電話旅客完整行程，不能替代旅客端登機可行性檢查。</p></div>`;
    const events=data.events.map(e=>{const labels={reservation_created:'建立預約',reservation_cancelled:'取消預約',waitlist_joined:'加入候補',waitlist_cancelled:'移除／拒絕候補',waitlist_offer_created:'發出候補邀請',waitlist_offer_accepted:'接受邀請',waitlist_offer_expired:'邀請過期',slot_created:'新增時段',slot_updated:'調整時段',reservation_replaced:'換約',demo_seeded:'初始化示範'};return `<div class="task"><span>${esc(labels[e.event_type]||'預約狀態更新')}${e.user_id?' · '+esc(user(e.user_id)?.display_name):''}</span><small class="muted">${formatAt(e.created_at)}</small></div>`;}).slice(0,5).join('')||'<p class="empty">尚無事件。</p>';
    return `<div class="cards">${card('今日已確認預約',s.confirmed,'件','calendar','所選日期 · 所有貴賓室')}${card('待確認邀請',s.offered,'件','calendar','只計有效的 offered 邀請'.replace('offered','待確認'))}${card('候補中顧客',s.waiting,'人','people',`${s.waitingEntries} 筆等待中記錄，按旅客去重`)}${card('可預約時段',s.bookable,'個','clock','已啟用、有未保留名額且無優先候補')}</div><div class="booking-grid"><div class="stack">${panel('預約時段處理','calendar',tool+table(['服務','貴賓室','時段','容量','已預約','候補','狀態','操作'],rows,foot))}${panel('所選範圍已確認預約','list',bookingRows(records),`<span class="muted">${records.length} 件 · 與篩選範圍一致</span>`)}</div><div class="stack">${panel('預約操作','people',manualPanel)}${panel('候補隊列','people',queueTable(queue),`<span class="muted">${queue.length} 筆</span>`)}${panel('近期預約事件','clock',events,'<span class="muted">全日期／全貴賓室</span>')}</div></div>`;
  }
  function render(){
    if(!data)return;
    $('pageTitle').textContent=titles[page];
    document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false');});
    const notice=`<div class="notice"><span>${esc(data.simulation.label)} 預測區間：16:00–20:00（香港時間）。</span><span>${data.lounges.length<6?button('載入六堂示範情境','reset','','secondary'):''}${button('立即同步','refresh','','secondary')}</span></div>`;
    $('content').innerHTML=notice+({overview,traffic,staff,bookings}[page])();
  }
  async function refresh(initial=false){
    if(loading||busy)return;loading=true;
    try{
      const requestedDate=date,next=await request('/api/ops/state?date='+encodeURIComponent(requestedDate));
      if(requestedDate!==date)return;
      data=next;
      if(initial&&!data.slots.length&&data.dates.length){date=data.dates[0];$('selectedDate').value=date;data=await request('/api/ops/state?date='+date);}
      $('syncStatus').classList.remove('failed');$('syncStatus').innerHTML='<span class="dot"></span>資料已同步';
      if(!$('actionDialog').open&&!document.activeElement?.matches('input,select,textarea'))render();
      else if(initial)render();
    }catch(error){$('syncStatus').classList.add('failed');$('syncStatus').textContent='同步失敗';if(!data){$('content').innerHTML=`<section class="panel access"><h2>營運入口需要授權</h2><p>${esc(error.message)}</p><p>請在本機執行 <code>npm start</code>，使用終端列出的「營運一次性入口」。登入僅在此瀏覽器有效，服務重啟後需重新登入。</p>${button('重試連線','refresh','','secondary')}</section>`;}else toast(error.message);}
    finally{loading=false;}
  }
  function openDialog(title,html,operation,label='確認操作'){
    pending=operation;$('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;$('dialogError').textContent='';$('confirmDialog').textContent=label;$('confirmDialog').hidden=!operation;$('actionDialog').showModal();
  }
  function closeDialog(){if(busy)return;$('actionDialog').close();pending=null;render();}
  function confirmAction(action,record){
    const body={action};let s,u,warning='確認後將更新共用預約資料庫。';
    if(action==='book'||action==='join'){body.userId=Number($('manualUser').value);body.slotId=Number(manual.slot);s=slot(body.slotId);u=user(body.userId);if(action==='book')body.idempotencyKey=crypto.randomUUID();}
    if(action==='cancel'){const r=data.reservations.find(r=>r.id===Number(record));if(!r)return;body.userId=r.user_id;body.reservationId=r.id;s=slot(r.service_slot_id);u=user(r.user_id);warning='取消後釋放名額，依先到先得規則發出邀請；下一位旅客不會自動成為已確認預約。';}
    if(action==='leave'||action==='accept'){const w=data.waitlist.find(w=>w.id===Number(record));if(!w)return;body.userId=w.user_id;body.entryId=w.id;s=slot(w.service_slot_id);u=user(w.user_id);warning=action==='accept'?'僅在旅客已明確同意的電話代辦情境使用；有效邀請才會建立預約。':'移除候補或拒絕邀請後，後續排名及邀請依既有規則更新。';}
    if(action==='offer'){body.slotId=Number(record);s=slot(record);warning='依真實 FIFO 規則維護過期及邀請，不會手動跳過排名或確認預約。';}
    if(!s||(!u&&action!=='offer')){toast('請先選擇有效的旅客及時段。');return;}
    const label={book:'新增預約',join:'加入候補',cancel:'取消預約',leave:'移除／拒絕候補',accept:'代旅客接受邀請',offer:'處理邀請'}[action];
    openDialog(label,`<p><strong>${esc(u?.display_name||'所選時段')}</strong></p><p>${esc(slotLabel(s))}</p><p>${esc(warning)}</p>`,{route:'/api/ops/actions',body},label);
  }
  function details(id){
    const s=slot(id);if(!s)return;selectedSlot=id;
    const records=data.reservations.filter(r=>r.service_slot_id===s.slot_id),queue=data.waitlist.filter(w=>w.service_slot_id===s.slot_id&&['waiting','offered','expired'].includes(w.status));
    openDialog('預約時段詳情',`<p>${esc(date+' · '+slotLabel(s))}</p><div class="details-grid">${[['容量',s.capacity],['已佔用',s.occupied],['邀請保留',s.held],['可用',s.available]].map(([l,n])=>`<div>${l}<strong>${n}</strong></div>`).join('')}</div><div class="actions">${button('調整容量','capacity',id,'secondary')}${button(s.active?'停用／移除時段':'重新啟用','toggle',id,s.active?'danger-button':'secondary')}${button('處理過期及邀請','offer',id,'secondary',!s.active)}</div><h3 class="subheading">預約記錄</h3>${bookingRows(records)}<h3 class="subheading">候補及邀請</h3>${queueTable(queue)}`,null);
  }
  function newSlot(){
    const links=data.catalog.filter(c=>c.reservation_mode!=='walk_in');
    openDialog('新增預約時段',`<p class="caption">只使用資料庫現有、可預約的服務組合；所有服務設定均為示範。時長須符合服務定義。</p><div class="form-grid"><label for="newService">貴賓室／服務</label><select id="newService">${options(links.map(c=>[c.lounge_service_id,lounge(c.lounge_id).display_name+' · '+c.display_name+'（'+c.default_duration_minutes+' 分鐘）']),links[0]?.lounge_service_id)}</select><label for="newDate">日期</label><input id="newDate" type="date" value="${date}"><label for="newStart">開始時間</label><input id="newStart" type="time" value="18:00"><label for="newEnd">結束時間</label><input id="newEnd" type="time" readonly><label for="newCapacity">容量</label><input id="newCapacity" type="number" min="1" max="1000" value="1"></div>`,{newSlot:true},'確認新增');updateEnd();
  }
  function updateEnd(){const c=data.catalog.find(c=>c.lounge_service_id===Number($('newService')?.value));if(!c||!$('newStart')?.value)return;const [h,m]=$('newStart').value.split(':').map(Number),n=h*60+m+c.default_duration_minutes;$('newEnd').value=n<1440?String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'):'';}
  async function commit(){
    if(!pending||busy)return;busy=true;$('confirmDialog').disabled=true;$('dialogError').textContent='';
    try{
      let p=pending;
      if(p.newSlot)p={route:'/api/ops/slots',body:{loungeServiceId:Number($('newService').value),date:$('newDate').value,start:$('newStart').value,end:$('newEnd').value,capacity:Number($('newCapacity').value)}};
      if(p.capacity)p={route:'/api/ops/slots/'+p.capacity,method:'PATCH',body:{capacity:Number($('editCapacity').value)}};
      const result=await request(p.route,p.method||'POST',p.body);
      $('actionDialog').close();pending=null;toast(result?.position===2?'示範已重建，旅客 A 位於候補第 2 位。':'操作完成，兩個介面將同步更新。');
    }catch(error){$('dialogError').textContent=error.message;}
    finally{busy=false;$('confirmDialog').disabled=false;await refresh();if(!$('actionDialog').open)render();}
  }
  async function action(name,id){
    if(busy)return;
    if(name==='refresh'){await refresh();render();return;}
    if(name==='navigate'){page=id;render();return;}
    if(name==='detail'){details(Number(id));return;}
    if(name==='new-slot'){newSlot();return;}
    if(name==='manual-book'||name==='manual-join'){confirmAction(name==='manual-book'?'book':'join');return;}
    if(name==='manual-cancel'){confirmAction('cancel',manual.reservation);return;}
    if(['cancel','leave','accept','offer'].includes(name)){if($('actionDialog').open)$('actionDialog').close();confirmAction(name,id);return;}
    if(name==='capacity'){const s=slot(id);$('actionDialog').close();openDialog('調整預約時段容量',`<p>${esc(slotLabel(s))}</p><p>容量不可低於已預約及邀請保留名額。增加容量後，會先依 FIFO 處理候補。</p><label for="editCapacity">新容量</label><input id="editCapacity" type="number" min="${s.occupied+s.held||1}" max="1000" value="${s.capacity}">`,{capacity:s.slot_id});return;}
    if(name==='toggle'){const s=slot(id);$('actionDialog').close();openDialog(s.active?'停用／移除預約時段':'重新啟用預約時段',`<p>${esc(slotLabel(s))}</p><p>保留歷史，不從資料庫硬刪除。有現存預約、邀請或候補時，必須先處理完畢才能停用。</p>`,{route:'/api/ops/slots/'+s.slot_id,method:s.active?'DELETE':'PATCH',...(s.active?{}:{body:{active:true}})});return;}
    if(name==='reset'){openDialog('重建可重現示範情境',`<p>將取消並重建 <strong>${esc(date)}</strong> 的示範時段 <strong>1001、1003、1004、1006</strong> 所有未結束預約與候補。其他時段不變，歷史及事件保留。</p><p>建立六堂分類、既有／新增示範旅客、滿額時段及待確認邀請。旅客 A 將在 1001 候補第 2 位。</p><p class="error">這會真實修改指定時段的 SQLite 記錄。請確認沒有需要保留的正在進行示範。</p>`,{route:'/api/ops/scenario',body:{date,confirmed:true}},'確認重建指定時段');return;}
    if(name==='flight'){const number=$('flightNumber').value,minutes=Number($('flightMinutes').value);openDialog('更新模擬航班',`<p>${esc(number)} 將相對原定時間延誤 ${esc(minutes)} 分鐘。只更新合成客流及人力需求，不會自動改動旅客行程。</p>`,{route:'/api/ops/flights',body:{date,number,minutes}});}
  }
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;render();}));
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)action(b.dataset.action,b.dataset.id);});
  document.addEventListener('change',e=>{
    const id=e.target.id,value=e.target.value;
    if(id==='selectedDate'){date=value;data=null;$('content').innerHTML='<div class="empty">正在讀取所選日期…</div>';refresh();return;}
    if(id==='loungeFilter')filters.lounge=value;
    if(id==='serviceFilter')filters.service=value;
    if(id==='forecastLounge')filters.forecast=value;
    const mapping={manualUser:'user',manualLounge:'lounge',manualService:'service',manualSlot:'slot',manualReservation:'reservation'};
    if(mapping[id]){manual[mapping[id]]=value;if(['manualLounge','manualService'].includes(id))manual.slot='';if(id==='manualUser')manual.reservation='';}
    if(id==='newStart'||id==='newService'){updateEnd();return;}
    if(['loungeFilter','serviceFilter','forecastLounge',...Object.keys(mapping)].includes(id))render();
  });
  document.addEventListener('input',e=>{
    if(e.target.id!=='userSearch')return;
    manual.search=e.target.value;
    const matches=data.users.filter(u=>u.display_name.includes(manual.search)||String(u.id).includes(manual.search));
    if(!matches.some(u=>u.id===Number(manual.user)))manual.user=matches[0]?.id||'';
    manual.reservation='';
    $('manualUser').innerHTML=options(matches.map(u=>[u.id,u.display_name+' · '+tiers[u.membership_tier]]),manual.user);
    const own=data.reservations.filter(r=>r.user_id===Number(manual.user)&&r.status==='confirmed');
    $('manualReservation').innerHTML=options(own.map(r=>[r.id,'#'+r.id+' '+slotLabel(slot(r.service_slot_id))]),'','請選擇要取消的預約');
    document.querySelector('[data-action="manual-cancel"]').disabled=true;
    for(const name of ['manual-book','manual-join'])document.querySelector(`[data-action="${name}"]`).disabled=!manual.user||!manual.slot;
  });
  $('closeDialog').addEventListener('click',closeDialog);$('backDialog').addEventListener('click',closeDialog);$('confirmDialog').addEventListener('click',commit);
  $('actionDialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
  $('selectedDate').value=date;
  async function authenticate(){
    const token=new URLSearchParams(location.hash.slice(1)).get('token');
    if(token){history.replaceState(null,'',location.pathname);try{await request('/api/ops/session','POST',{token});}catch(error){toast(error.message);}}
  }
  globalThis.addEventListener?.('hashchange',async()=>{await authenticate();await refresh(true);});
  async function init(){
    if(location.protocol==='file:'){
      $('syncStatus').classList.add('failed');$('syncStatus').textContent='尚未啟動本機服務';
      $('content').innerHTML='<section class="panel access"><h2>請先啟動貴賓室運營中心</h2><p>你目前直接開啟的是硬碟上的 HTML 檔案。預約資料及操作權限需要由本機服務提供。</p><p>請回到此專案資料夾，雙擊 <strong>start-operations.cmd</strong>。它會啟動服務並自動打開已授權的營運頁面；請保持啟動視窗開啟。</p><p>也可在資料夾的 PowerShell 執行 <code>npm.cmd start</code>，再使用終端列出的「營運一次性入口」。</p></section>';
      return;
    }
    await authenticate();
    await refresh(true);setInterval(()=>refresh(),2500);
  }
  init();
})();
