(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./reservation-model'):root.ReservationModel);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ReservationUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(model){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status={waiting:'候補中',offered:'已獲邀，待接受',accepted:'已接受',expired:'邀請已過期',cancelled:'已取消',confirmed:'已預約',completed:'已完成',no_show:'未到場'};
  const errors={SLOT_FULL:'名額已被佔用，請重新整理後加入候補。',SLOT_AVAILABLE:'已有空位，請重新整理後預約。',WAITLIST_PRIORITY:'名額優先安排候補，請重新整理查看。',ALREADY_RESERVED:'已有此時段預約，請重新整理查看。',OFFER_EXPIRED:'邀請已過期，請重新加入候補。',OFFER_NOT_AVAILABLE:'邀請已失效，請重新整理。',WAITLIST_OFFER_PENDING:'請先接受或拒絕已有邀請。',NOT_ELIGIBLE:'目前示範會員不符合資格。'};
  function createController({fetchImpl=fetch,context,show,update,notify=()=>{},uuid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now()}){
    let slots=[],reservations=[],waitlist=[],dates=[],pending=null,busy=false,visible=false,loadVersion=0;
    let filters={date:model.tripDate(context()),lounge:'',type:''},replacement=null,message='',activeView='slots';
    async function request(route,method='GET',body){
      let response;
      try{response=await fetchImpl(route,{method,headers:{'Content-Type':'application/json','X-Demo-User-Id':'1'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch(_){throw new Error('連接失敗。請重試同一確認請求，或刷新查看是否已完成。');}
      const result=await response.json();
      if(!response.ok)throw new Error(errors[result.error?.code]||result.error?.message||'預約服務暫時不可用，請重試。');
      return result;
    }
    const signature=()=>JSON.stringify(context());
    const slotFor=row=>slots.find(s=>s.slot_id===row.service_slot_id);
    const serviceNames={shower:'淋浴',dining:'晚餐',massage:'按摩',rest:'休息／日間套房',work:'工作空間'};
    const serviceName=slot=>serviceNames[slot.service_code]||slot.display_name;
    const displayErrors={'此数据库地点尚未接入行程路线，暂不能预约。':'目前尚未支援這個地點的行程安排。','请选择本次旅程日期的时段。':'請選擇本次旅程日期的時段。','行程最多支持 12 项活动。':'行程最多支援 12 項活動。'};
    const displayError=text=>displayErrors[text]||text;
    const label=slot=>slot?slot.service_date+' '+slot.start_time+'–'+slot.end_time+' '+serviceName(slot)+' · '+loungeName(slot.lounge_name):'時段資料暫不可用';
    function fits(slot){return model.planSlot(context(),slot,replacement);}
    const loungeNames={'The Wing First':'寰宇堂頭等貴賓室','The Pier First':'玉衡堂頭等貴賓室','The Wing Business':'寰宇堂商務貴賓室','The Pier Business':'玉衡堂商務貴賓室','The Deck':'玲瓏堂'};
    const loungeName=name=>loungeNames[name]||name;
    function button(action,id,label,disabled=false){
      const primary=['commit','accept','book','swap'].includes(action);
      return '<button type="button" class="'+(primary?'booking-action-primary':'')+'" data-booking="'+action+'" data-record="'+id+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
    }
    function slotSummary(slot){
      return slot?'<strong>'+esc(slot.start_time+'–'+slot.end_time+'　'+serviceName(slot))+'</strong><span>'+esc(slot.service_date+' · '+loungeName(slot.lounge_name))+'</span>':'<strong>時段資料暫不可用</strong>';
    }
    function render(){
      if(!visible)return;
      if(pending){show('<div class="booking-panel"><h3>確認'+esc(pending.label)+'</h3><p>'+esc(label(pending.slot))+'</p><p class="sheet-note">'+esc(pending.action==='cancel'?'取消後將釋放名額，行程中的活動會保留為待預約。':pending.action==='leave'?'確認後將退出候補或拒絕本次邀請。':'確認後將保存這項預約操作，並同步更新行程。')+'</p><p class="sheet-error" role="alert">'+esc(message)+'</p><div class="booking-actions">'+button('back',0,'返回',busy)+button('commit',0,busy?'正在處理…':'確認'+pending.label,busy)+'</div></div>');return;}
      const filtered=slots.filter(s=>s.service_date===filters.date&&(!filters.lounge||String(s.lounge_id)===filters.lounge)&&(!filters.type||s.service_code===filters.type));
      const lounges=[...new Map(slots.map(s=>[s.lounge_id,s.lounge_name])).entries()];
      const dateOptions=[...new Set([filters.date,...dates])].sort();
      const controls='<div class="booking-filters"><label class="field">日期<select data-booking-filter="date">'+dateOptions.map(d=>'<option '+(d===filters.date?'selected':'')+'>'+esc(d)+'</option>').join('')+'</select></label><label class="field">貴賓室<select data-booking-filter="lounge"><option value="">全部貴賓室</option>'+lounges.map(([id,name])=>'<option value="'+id+'" '+(String(id)===filters.lounge?'selected':'')+'>'+esc(loungeName(name))+'</option>').join('')+'</select></label><label class="field">服務<select data-booking-filter="type"><option value="">全部服務</option>'+[...new Map(slots.map(s=>[s.service_code,serviceName(s)])).entries()].map(([type,name])=>'<option value="'+esc(type)+'" '+(type===filters.type?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label></div>';
      const bookingRows=reservations.filter(r=>r.status==='confirmed').map(r=>'<article class="booking-row">'+slotSummary(slotFor(r))+'<span>已預約 · 編號 '+r.id+'</span><div class="booking-actions">'+button('cancel',r.id,'取消預約',busy)+button('replace',r.id,'更改時段',busy)+'</div></article>').join('')||'<p class="sheet-note">暫無預約。可到「可選時段」選擇服務並確認。</p>';
      const queueRows=waitlist.filter(w=>w.status!=='accepted'&&w.status!=='cancelled').map(w=>{
        const slot=slotFor(w),check=slot?fits(slot):{valid:false,errors:['時段不可用']};
        const remaining=w.offer_expires_at?Math.max(0,Math.ceil((Date.parse(w.offer_expires_at)-now())/1000)):0;
        const expired=w.status==='expired'||w.status==='offered'&&!remaining;
        return '<article class="booking-row">'+slotSummary(slot)+'<span>'+esc(expired?'邀請已過期':status[w.status])+(w.status==='waiting'?' · 第 '+w.position+' 位':'')+(w.status==='offered'&&!expired?' · 剩餘 '+remaining+' 秒':'')+'</span>'+(!check.valid&&w.status==='offered'?'<small>'+esc(displayError(check.errors[0]))+'</small>':'')+'<div class="booking-actions">'+(w.status==='offered'&&!expired?button('accept',w.id,'接受邀請',busy||!check.valid):'')+(['waiting','offered'].includes(w.status)&&!expired?button('leave',w.id,w.status==='offered'?'拒絕邀請':'退出候補',busy):'')+'</div></article>';
      }).join('')||'<p class="sheet-note">暫無候補。服務滿額時，可在「可選時段」加入候補。</p>';
      const rows=filtered.map(slot=>{
        const check=fits(slot),own=reservations.some(r=>r.service_slot_id===slot.slot_id&&r.status!=='cancelled'),queued=waitlist.some(w=>w.service_slot_id===slot.slot_id&&['waiting','offered'].includes(w.status));
        const canQueue=slot.available===0&&!own&&!queued;
        const action=replacement?'swap':slot.direct_bookable?'book':'join';
        const disabled=busy||own||queued||!check.valid||(replacement?!slot.direct_bookable:!slot.direct_bookable&&!canQueue);
        const detail='容量 '+slot.capacity+' · 已預約 '+slot.occupied+' · 保留 '+slot.held+' · 可用 '+slot.available+' · 候補 '+slot.waiting_count;
        const availability=slot.direct_bookable?'尚有名額 · 餘 '+slot.available+' 個名額':slot.available>0?'優先安排候補':'暫無空位';
        return '<article class="booking-row">'+slotSummary(slot)+'<span>'+esc(availability)+'</span>'+(!check.valid?'<small>'+esc(displayError(check.errors[0]))+'</small>':'')+'<div class="booking-actions">'+button(action,slot.slot_id,own?'已有預約':queued?'已候補／獲邀':replacement?'換到此時段':slot.direct_bookable?'預約此時段':'加入候補',disabled)+'</div><details class="booking-inventory" data-slot="'+slot.slot_id+'"><summary>示範庫存詳情</summary><div>'+esc(detail)+'</div></details></article>';
      }).join('')||'<p class="sheet-note">目前條件下沒有可選時段，請調整日期或篩選條件。</p>';
      const views=[['slots','可選時段'],['reservations','我的預約'],['waitlist','我的候補']];
      const tabs='<nav class="booking-tabs" aria-label="預約分類">'+views.map(([key,name])=>'<button class="booking-tab" type="button" data-booking="tab-'+key+'" data-record="0" aria-pressed="'+(activeView===key)+'">'+name+'</button>').join('')+'</nav>';
      const feedback='<p class="'+(message.startsWith('已完成')?'booking-notice':'sheet-error')+'" role="status">'+esc(message)+'</p>';
      show('<div class="booking-panel"><p class="booking-demo">示範預約 · 旅客 A · 並非國泰實際預約</p>'+tabs+feedback+'<section aria-label="可選時段" '+(activeView!=='slots'?'hidden':'')+'>'+controls+(replacement?'<p class="sheet-note">更改時段成功前，原預約會保留。</p>'+button('stop-replace',0,'取消更改'):'')+rows+'</section><section aria-label="我的預約" '+(activeView!=='reservations'?'hidden':'')+'>'+bookingRows+'</section><section aria-label="我的候補" '+(activeView!=='waitlist'?'hidden':'')+'>'+queueRows+'</section><div class="booking-refresh">'+button('refresh',0,'重新整理',busy)+'</div></div>');
    }
    async function load(){
      const version=++loadVersion;
      try{
        const [inventory,bookings,queue]=await Promise.all([request('/api/availability'),request('/api/users/1/reservations'),request('/api/users/1/waitlist')]);
        if(version!==loadVersion)return;
        slots=inventory.slots;dates=inventory.dates;reservations=bookings.data;waitlist=queue.data;
        update(model.reconcile(context().activities,reservations,waitlist,slots));
        render();
      }catch(error){if(version!==loadVersion)return;message=error.message;if(pending)render();else if(visible)show('<p class="sheet-error" role="alert">'+esc(message)+'</p>'+button('refresh',0,'重試'));}
    }
    async function open(type=''){visible=true;pending=null;replacement=null;filters.type=typeof type==='string'?type:'';activeView=filters.type?'slots':'waitlist';message='';show('<p class="sheet-note">正在載入時段與候補…</p>');await load();}
    function prepare(action,id){
      if(busy)return false;
      let row,slot,plan;
      if(action==='book'||action==='join'||action==='swap')slot=slots.find(s=>s.slot_id===id);
      else if(action==='accept'){row=waitlist.find(w=>w.id===id);slot=slotFor(row||{});}
      else if(action==='cancel'){row=reservations.find(r=>r.id===id);slot=slotFor(row||{});}
      else if(action==='leave'){row=waitlist.find(w=>w.id===id);slot=slotFor(row||{});}
      if(!slot)return false;
      if(['book','join','swap','accept'].includes(action)){plan=model.planSlot(context(),slot,action==='swap'?replacement:undefined);if(!plan.valid){message=plan.errors.map(displayError).join(' ');render();return false;}}
      const labels={book:'預約',join:'加入候補',swap:'換約',accept:'接受邀請',cancel:'取消預約',leave:'退出／拒絕候補'};
      pending={action,id,slot,plan,label:labels[action],base:signature(),key:uuid(),replacement};message='';render();return true;
    }
    async function commit(){
      if(!pending||busy)return false;
      if(signature()!==pending.base){message='行程已變更，請返回重新選擇時段。';render();return false;}
      const p=pending;busy=true;render();
      try{
        let route,method='POST',body={context:context()};
        if(p.action==='book'){route='/api/reservations';body.slotId=p.id;body.idempotencyKey=p.key;}
        if(p.action==='join'){route='/api/waitlist';body.slotId=p.id;}
        if(p.action==='swap'){route='/api/reservations/'+p.replacement+'/replace';body.newSlotId=p.id;body.idempotencyKey=p.key;}
        if(p.action==='accept')route='/api/waitlist/'+p.id+'/accept';
        if(p.action==='cancel'){route='/api/reservations/'+p.id;method='DELETE';body=undefined;}
        if(p.action==='leave'){route='/api/waitlist/'+p.id;method='DELETE';body=undefined;}
        const response=await request(route,method,body),row=response.data;
        if(p.plan){
          // Never overwrite changes made while the request was pending. The DB record remains visible.
          if(signature()===p.base){const item={...p.plan.item,...(p.action==='join'?{waitlistEntryId:row.id,status:'pending',bookingState:row.status}:{reservationId:row.id,status:'confirmed',bookingState:row.status})};update(p.plan.draft.map(a=>a.id===item.id?item:a));}
          else notify('預約操作已完成。行程已有其他修改，請在「我的預約」核對。');
        }
        pending=null;replacement=null;activeView=p.action==='join'||p.action==='leave'?'waitlist':'reservations';message='已完成'+p.label+'。';await load();render();notify(message);return true;
      }catch(error){message=error.message;await load();render();return false;}
      finally{busy=false;render();}
    }
    async function action(name,id){
      if(busy)return;
      if(name.startsWith('tab-')&&['slots','reservations','waitlist'].includes(name.slice(4))){activeView=name.slice(4);render();return;}
      if(name==='commit')return commit();
      if(name==='back'){pending=null;message='';render();return;}
      if(name==='refresh'){message='';return load();}
      if(name==='replace'){replacement=id;pending=null;activeView='slots';render();return;}
      if(name==='stop-replace'){replacement=null;render();return;}
      return prepare(name,id);
    }
    function filter(name,value){if(!busy&&!pending){filters[name]=value;render();}}
    function close(){visible=false;}
    function tick(){if(visible&&!busy&&!pending)return load();}
    return {open,load,action,commit,filter,close,tick,get:()=>({slots,reservations,waitlist,pending,busy})};
  }
  return {createController};
});
