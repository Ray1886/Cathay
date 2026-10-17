'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAppServer}=require('../server');
const {openDatabase}=require('../backend/db'),{seedDatabase}=require('../database/seed'),{createReservationService}=require('../backend/reservation-service');
const {createController}=require('../reservation-ui'),model=require('../reservation-model');
const {demoState}=require('../recovery/demo'),{policy}=require('../recovery/integration');
async function fixture(t){
  const db=openDatabase();seedDatabase(db,{date:'2026-10-11'});let now=Date.parse('2026-10-11T17:20:00+08:00');
  const service=createReservationService({db,clock:()=>new Date(now),offerTtlMs:1000});
  const server=createAppServer({reservationService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const fetchImpl=(route,options)=>fetch(base+route,options);
  const state=demoState();state.currentItinerary[0].status='confirmed';let current={...policy(state),serviceDate:'2026-10-11',activities:state.currentItinerary};let html='';let keys=0;
  const controller=()=>createController({fetchImpl,context:()=>current,show:value=>{html=value;},update:activities=>{current={...current,activities,journey:{...current.journey,currentItinerary:activities}};},uuid:()=>`integration-${++keys}`,now:()=>now});
  const ui=controller();
  return {db,service,ui,controller,fetchImpl,get:()=>current,html:()=>html,advance:ms=>{now+=ms;},change:()=>{current.activities[1].start='18:06';current.activities[1].startAt='2026-10-11T18:06:00+08:00';}};
}
test('main inventory reads SQLite capacity and never falls back to static availability',async t=>{
  const f=await fixture(t);let data=await (await f.fetchImpl('/api/availability')).json();assert.equal(data.source,'sqlite-demo');assert.equal(data.slots.find(s=>s.slot_id===1001).available,1);
  f.service.createReservation(2,1001,'other-booking');data=await (await f.fetchImpl('/api/availability')).json();assert.equal(data.slots.find(s=>s.slot_id===1001).available,0);
});
test('UI preview/back has no writes; approval books once and reload reconciles actual status',async t=>{
  const f=await fixture(t);await f.ui.open();const before=f.service.getUserReservations(1).length;
  assert.equal(f.ui.get().reservations.length,before);assert.equal(f.get().activities[0].status,'pending');
  assert.equal(await f.ui.action('book',1001),true);assert.equal(f.service.getUserReservations(1).length,before);await f.ui.action('back',0);assert.equal(f.service.getUserReservations(1).length,before);
  await f.ui.action('book',1001);assert.equal(await f.ui.commit(),true);assert.equal(await f.ui.commit(),false);
  const linked=f.get().activities.find(a=>a.slotId===1001);assert.equal(linked.status,'confirmed');assert.ok(linked.reservationId);
  await f.controller().load();assert.equal(f.get().activities.find(a=>a.slotId===1001).status,'confirmed');
  await f.ui.action('cancel',linked.reservationId);assert.equal(f.service.getUserReservations(1).find(r=>r.id===linked.reservationId).status,'confirmed');
  await f.ui.commit();assert.equal(f.service.getUserReservations(1).find(r=>r.id===linked.reservationId).status,'cancelled');assert.equal(f.get().activities.find(a=>a.slotId===1001).status,'pending');
});
test('UI joins real FIFO queue, renders offer and accepts it into one persisted booking',async t=>{
  const f=await fixture(t);const other=f.service.createReservation(2,1001,'fifo-owner');await f.ui.open();await f.ui.action('join',1001);assert.equal(await f.ui.commit(),true);
  const entry=f.ui.get().waitlist.find(w=>w.service_slot_id===1001);assert.equal(entry.position,1);assert.equal(f.get().activities.find(a=>a.slotId===1001).bookingState,'waiting');assert.match(f.html(),/第 1 位/);
  f.service.cancelReservation(other.id,2);await f.ui.load();assert.equal(f.ui.get().waitlist.find(w=>w.id===entry.id).status,'offered');assert.match(f.html(),/接受邀請/);
  await f.ui.action('accept',entry.id);assert.equal(await f.ui.commit(),true);assert.equal(f.get().activities.find(a=>a.slotId===1001).status,'confirmed');assert.equal(f.service.getUserWaitlist(1).find(w=>w.id===entry.id).status,'accepted');
});
test('expired offers are displayed and cannot be accepted',async t=>{
  const f=await fixture(t),other=f.service.createReservation(2,1001,'expiry-owner');await f.ui.open();await f.ui.action('join',1001);await f.ui.commit();f.service.cancelReservation(other.id,2);await f.ui.load();
  const entry=f.ui.get().waitlist.find(w=>w.service_slot_id===1001);await f.ui.action('accept',entry.id);f.advance(1100);assert.equal(await f.ui.commit(),false);assert.equal(f.service.getUserReservations(1).filter(r=>r.service_slot_id===1001).length,0);
  await f.ui.action('back',0);assert.match(f.html(),/邀請已過期/);
});
test('replacement rechecks capacity, leaves original intact on conflict, then commits atomically',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO service_slots(id,lounge_service_id,service_date,start_time,end_time,capacity,active) VALUES (2001,103,'2026-10-11','18:35','18:50',1,1)").run();
  await f.ui.open();await f.ui.action('book',1001);await f.ui.commit();const old=f.get().activities.find(a=>a.slotId===1001).reservationId;
  await f.ui.action('replace',old);await f.ui.action('swap',2001);const other=f.service.createReservation(2,2001,'swap-competitor');assert.equal(await f.ui.commit(),false);assert.equal(f.service.getUserReservations(1).find(r=>r.id===old).status,'confirmed');
  f.service.cancelReservation(other.id,2);assert.equal(await f.ui.commit(),true);assert.equal(f.service.getUserReservations(1).find(r=>r.id===old).status,'cancelled');assert.equal(f.get().activities.find(a=>a.slotId===2001).status,'confirmed');
});
test('stale itinerary blocks approval; unknown locations, dates and overlapping bookings are rejected server-side',async t=>{
  const f=await fixture(t);await f.ui.open();await f.ui.action('book',1001);f.change();assert.equal(await f.ui.commit(),false);assert.equal(f.service.getUserReservations(1).filter(r=>r.service_slot_id===1001).length,0);
  const response=await f.fetchImpl('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json','X-Demo-User-Id':'1'},body:JSON.stringify({slotId:1008,idempotencyKey:'unknown-location',context:f.get()})});assert.equal(response.status,409);
  const slot=f.service.getSlotAvailability(1001);assert.equal(model.planSlot({...f.get(),journey:null,serviceDate:'2026-10-12'},slot).valid,false);
});
test('failed inventory request produces a retry error instead of invented capacity',async()=>{
  let html='';const ui=createController({context:()=>({activities:[]}),fetchImpl:async()=>{throw Error('offline');},show:value=>{html=value;},update:()=>{throw Error('must not update');}});
  await ui.open();assert.equal(ui.get().slots.length,0);assert.match(html,/連接失敗/);assert.doesNotMatch(html,/示範空位|示範排隊/);
});
test('ambiguous booking response retries the same key without a duplicate record',async t=>{
  const f=await fixture(t);let once=true,keys=[];
  const ui=createController({context:f.get,show:()=>{},update:()=>{},uuid:()=> 'ambiguous-booking',fetchImpl:async(route,options)=>{
    if(route==='/api/reservations'){keys.push(JSON.parse(options.body).idempotencyKey);const response=await f.fetchImpl(route,options);if(once){once=false;throw Error('lost response');}return response;}
    return f.fetchImpl(route,options);
  }});
  await ui.open();await ui.action('book',1001);assert.equal(await ui.commit(),false);assert.ok(ui.get().pending);assert.equal(await ui.commit(),true);
  assert.deepEqual(keys,['ambiguous-booking','ambiguous-booking']);assert.equal(f.service.getUserReservations(1).filter(r=>r.service_slot_id===1001).length,1);
});
test('late booking response does not overwrite concurrent itinerary edits',async t=>{
  const f=await fixture(t);let updates=0;
  const ui=createController({context:f.get,show:()=>{},update:()=>{updates++;},uuid:()=> 'concurrent-edit',fetchImpl:async(route,options)=>{
    const response=await f.fetchImpl(route,options);if(route==='/api/reservations')f.change();return response;
  }});
  await ui.open();await ui.action('book',1001);const before=updates;assert.equal(await ui.commit(),true);assert.equal(updates,before+1);assert.equal(f.get().activities[1].start,'18:06');assert.equal(f.get().activities.find(a=>a.id===3).reservationId,undefined);assert.ok(ui.get().reservations.some(r=>r.service_slot_id===1001&&r.status==='confirmed'));
});
