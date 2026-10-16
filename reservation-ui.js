(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./reservation-model'):root.ReservationModel);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ReservationUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(model){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status={waiting:'排队中',offered:'已获邀，待接受',accepted:'已接受',expired:'邀请已过期',cancelled:'已取消',confirmed:'已预约',completed:'已完成',no_show:'未到场'};
  const errors={SLOT_FULL:'名额已被占用，请刷新后加入候补。',SLOT_AVAILABLE:'已有空位，请刷新后预约。',WAITLIST_PRIORITY:'名额优先分配给候补，请刷新查看。',ALREADY_RESERVED:'已有此时段预约，请刷新查看。',OFFER_EXPIRED:'邀请已过期，请重新候补。',OFFER_NOT_AVAILABLE:'邀请已失效，请刷新。',WAITLIST_OFFER_PENDING:'请先接受或拒绝已有邀请。',NOT_ELIGIBLE:'当前示范会员不符合资格。'};
  function createController({fetchImpl=fetch,context,show,update,notify=()=>{},uuid=()=>globalThis.crypto.randomUUID(),now=()=>Date.now()}){
    let slots=[],reservations=[],waitlist=[],dates=[],pending=null,busy=false,visible=false,loadVersion=0;
    let filters={date:model.tripDate(context()),lounge:'',type:''},replacement=null,message='';
    async function request(route,method='GET',body){
      let response;
      try{response=await fetchImpl(route,{method,headers:{'Content-Type':'application/json','X-Demo-User-Id':'1'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch(_){throw new Error('连接失败。请重试同一确认请求，或刷新查看是否已完成。');}
      const result=await response.json();
      if(!response.ok)throw new Error(errors[result.error?.code]||result.error?.message||'预约服务暂时不可用，请重试。');
      return result;
    }
    const signature=()=>JSON.stringify(context());
    const slotFor=row=>slots.find(s=>s.slot_id===row.service_slot_id);
    const label=slot=>slot?slot.service_date+' '+slot.start_time+'–'+slot.end_time+' '+slot.display_name+' · '+slot.lounge_name:'时段资料暂不可用';
    function fits(slot){return model.planSlot(context(),slot,replacement);}
    function button(action,id,label,disabled=false){return '<button type="button" data-booking="'+action+'" data-record="'+id+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';}
    function render(){
      if(!visible)return;
      if(pending){show('<div class="booking-panel"><h3>确认'+esc(pending.label)+'</h3><p>'+esc(label(pending.slot))+'</p><p class="sheet-note">'+esc(pending.action==='cancel'?'取消数据库预约并释放名额；关联活动会保留为待预约。':pending.action==='leave'?'退出候补或拒绝本次邀请。':'确认后会写入本机预约数据库，并同步关联行程。')+'</p><p class="sheet-error" role="alert">'+esc(message)+'</p><div class="booking-actions">'+button('back',0,'返回',busy)+button('commit',0,busy?'正在处理…':'确认'+pending.label,busy)+'</div></div>');return;}
      const filtered=slots.filter(s=>s.service_date===filters.date&&(!filters.lounge||String(s.lounge_id)===filters.lounge)&&(!filters.type||s.service_code===filters.type));
      const lounges=[...new Map(slots.map(s=>[s.lounge_id,s.lounge_name])).entries()];
      const dateOptions=[...new Set([filters.date,...dates])].sort();
      const controls='<div class="booking-filters"><label class="field">旅程日期<select data-booking-filter="date">'+dateOptions.map(d=>'<option '+(d===filters.date?'selected':'')+'>'+esc(d)+'</option>').join('')+'</select></label><label class="field">贵宾室<select data-booking-filter="lounge"><option value="">全部</option>'+lounges.map(([id,name])=>'<option value="'+id+'" '+(String(id)===filters.lounge?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label><label class="field">服务<select data-booking-filter="type"><option value="">全部</option>'+[...new Map(slots.map(s=>[s.service_code,s.display_name])).entries()].map(([type,name])=>'<option value="'+esc(type)+'" '+(type===filters.type?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label></div>';
      const bookingRows=reservations.filter(r=>r.status==='confirmed').map(r=>'<article class="booking-row"><strong>'+esc(label(slotFor(r)))+'</strong><span>已预约 · 编号 '+r.id+'</span><div class="booking-actions">'+button('cancel',r.id,'取消预约',busy)+button('replace',r.id,'选择新时段换约',busy)+'</div></article>').join('')||'<p class="sheet-note">暂无数据库预约。</p>';
      const queueRows=waitlist.filter(w=>w.status!=='accepted'&&w.status!=='cancelled').map(w=>{
        const slot=slotFor(w),check=slot?fits(slot):{valid:false,errors:['时段不可用']};
        const remaining=w.offer_expires_at?Math.max(0,Math.ceil((Date.parse(w.offer_expires_at)-now())/1000)):0;
        const expired=w.status==='expired'||w.status==='offered'&&!remaining;
        return '<article class="booking-row"><strong>'+esc(label(slot))+'</strong><span>'+esc(expired?'邀请已过期':status[w.status])+(w.status==='waiting'?' · 第 '+w.position+' 位':'')+(w.status==='offered'&&!expired?' · 剩余 '+remaining+' 秒':'')+'</span>'+(!check.valid&&w.status==='offered'?'<small>'+esc(check.errors[0])+'</small>':'')+'<div class="booking-actions">'+(w.status==='offered'&&!expired?button('accept',w.id,'接受邀请',busy||!check.valid):'')+(['waiting','offered'].includes(w.status)&&!expired?button('leave',w.id,w.status==='offered'?'拒绝邀请':'退出候补',busy):'')+'</div></article>';
      }).join('')||'<p class="sheet-note">暂无候补记录。待预约活动不代表已经加入候补。</p>';
      const rows=filtered.map(slot=>{
        const check=fits(slot),own=reservations.some(r=>r.service_slot_id===slot.slot_id&&r.status!=='cancelled'),queued=waitlist.some(w=>w.service_slot_id===slot.slot_id&&['waiting','offered'].includes(w.status));
        const canQueue=slot.available===0&&!own&&!queued;
        const action=replacement?'swap':slot.direct_bookable?'book':'join';
        const disabled=busy||own||queued||!check.valid||(replacement?!slot.direct_bookable:!slot.direct_bookable&&!canQueue);
        const detail='容量 '+slot.capacity+' · 已预约 '+slot.occupied+' · 保留 '+slot.held+' · 可用 '+slot.available+' · 排队 '+slot.waiting_count;
        return '<article class="booking-row"><strong>'+esc(label(slot))+'</strong><span>'+esc(detail)+'</span>'+(!check.valid?'<small>'+esc(check.errors[0])+'</small>':'')+'<div class="booking-actions">'+button(action,slot.slot_id,own?'已有预约':queued?'已候补／获邀':replacement?'换到此时段':slot.direct_bookable?'预约此时段':'加入候补',disabled)+'</div></article>';
      }).join('')||'<p class="sheet-note">此日期和筛选条件没有数据库时段；不会显示虚构空位。</p>';
      show('<div class="booking-panel"><p class="sheet-note">本机 SQLite 示范库存 · 当前为示范旅客 A。预约状态来自数据库；航班与路线仍为模拟资料。</p><p class="sheet-error" role="alert">'+esc(message)+'</p>'+button('refresh',0,'刷新状态',busy)+controls+(replacement?'<p>正在换约：原预约在成功前保留。</p>'+button('stop-replace',0,'取消换约选择'):'')+'<h3>我的预约</h3>'+bookingRows+'<h3>我的候补与邀请</h3>'+queueRows+'<h3>可选时段</h3>'+rows+'</div>');
    }
    async function load(){
      const version=++loadVersion;
      try{
        const [inventory,bookings,queue]=await Promise.all([request('/api/availability'),request('/api/users/1/reservations'),request('/api/users/1/waitlist')]);
        if(version!==loadVersion)return;
        slots=inventory.slots;dates=inventory.dates;reservations=bookings.data;waitlist=queue.data;
        update(model.reconcile(context().activities,reservations,waitlist,slots));
        render();
      }catch(error){if(version!==loadVersion)return;message=error.message;if(pending)render();else if(visible)show('<p class="sheet-error" role="alert">'+esc(message)+'</p>'+button('refresh',0,'重试'));}
    }
    async function open(type=''){visible=true;pending=null;replacement=null;filters.type=typeof type==='string'?type:'';message='';show('<p class="sheet-note">正在查询数据库时段和候补…</p>');await load();}
    function prepare(action,id){
      if(busy)return false;
      let row,slot,plan;
      if(action==='book'||action==='join'||action==='swap')slot=slots.find(s=>s.slot_id===id);
      else if(action==='accept'){row=waitlist.find(w=>w.id===id);slot=slotFor(row||{});}
      else if(action==='cancel'){row=reservations.find(r=>r.id===id);slot=slotFor(row||{});}
      else if(action==='leave'){row=waitlist.find(w=>w.id===id);slot=slotFor(row||{});}
      if(!slot)return false;
      if(['book','join','swap','accept'].includes(action)){plan=model.planSlot(context(),slot,action==='swap'?replacement:undefined);if(!plan.valid){message=plan.errors.join(' ');render();return false;}}
      const labels={book:'预约',join:'加入候补',swap:'换约',accept:'接受邀请',cancel:'取消预约',leave:'退出／拒绝候补'};
      pending={action,id,slot,plan,label:labels[action],base:signature(),key:uuid(),replacement};message='';render();return true;
    }
    async function commit(){
      if(!pending||busy)return false;
      if(signature()!==pending.base){message='行程已变化，请返回重新选择时段。';render();return false;}
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
          else notify('数据库操作已完成；行程已变化，请在我的预约中核对，不会覆盖新行程。');
        }
        pending=null;replacement=null;message='已完成'+p.label+'。';await load();render();notify(message);return true;
      }catch(error){message=error.message;await load();render();return false;}
      finally{busy=false;render();}
    }
    async function action(name,id){
      if(busy)return;
      if(name==='commit')return commit();
      if(name==='back'){pending=null;message='';render();return;}
      if(name==='refresh'){message='';return load();}
      if(name==='replace'){replacement=id;pending=null;render();return;}
      if(name==='stop-replace'){replacement=null;render();return;}
      return prepare(name,id);
    }
    function filter(name,value){if(!busy&&!pending){filters[name]=value;render();}}
    function close(){visible=false;}
    // Inventory can change in the operations tab while this sheet is closed.
    // Never refresh a pending confirmation or replace a user's activity draft.
    function tick(){if(!busy&&!pending)return load();}
    return {open,load,action,commit,filter,close,tick,get:()=>({slots,reservations,waitlist,pending,busy})};
  }
  return {createController};
});
