'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('../backend/db');
const {seedDatabase}=require('../database/seed');
const {resetOperationsDemo}=require('../database/operations-demo');
const {createReservationService}=require('../backend/reservation-service');
const {createOperationsService}=require('../backend/operations-service');
const {createOperationsApi}=require('../backend/operations-api');
const {createAppServer}=require('../server');
const {createController}=require('../reservation-ui');
const {demoState}=require('../recovery/demo');
const {policy}=require('../recovery/integration');
const DATE='2026-10-11';
function fixture(t,{demo=true}={}){
  const db=openDatabase();seedDatabase(db,{date:DATE});let ms=Date.parse(DATE+'T17:20:00+08:00');
  const service=createReservationService({db,clock:()=>new Date(ms),offerTtlMs:1000});
  if(demo)resetOperationsDemo(db,service,{date:DATE,confirmed:true});
  const ops=createOperationsService({db,service,clock:()=>new Date(ms)});
  t.after(()=>db.close());return {db,service,ops,now:()=>ms,snapshot:()=>ops.snapshot(DATE),advance:n=>ms+=n};
}
async function httpFixture(t,options){
  const f=fixture(t,options),api=createOperationsApi({operations:f.ops,db:f.db,service:f.service,accessToken:'test-only-operator-token'});
  const server=createAppServer({reservationService:f.service,operationsApi:api.handler,operationsService:f.ops});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  // Registered after database cleanup: node:test runs after hooks in registration order.
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;let cookie='';
  async function send(route,method='GET',body,extra={}){
    return fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Ops-Request':'1',Origin:base,...(cookie?{Cookie:cookie}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  }
  const login=await send('/api/ops/session','POST',{token:'test-only-operator-token'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  return {...f,send,base,cookie};
}
test('operations shares one SQLite source and separates people, reservations, holds and arrivals',t=>{
  const f=fixture(t),s=f.snapshot();assert.equal(s.lounges.length,6);assert.equal(s.analytics.summary.occupancy,22);assert.equal(s.analytics.summary.confirmed,5);assert.equal(s.analytics.summary.waiting,3);assert.equal(s.analytics.summary.offered,1);
  assert.equal(s.analytics.summary.occupancy,s.analytics.rows.reduce((n,r)=>n+r.currentOccupancy,0));
  assert.equal(s.analytics.summary.confirmed,s.reservations.filter(r=>r.status==='confirmed').length);
  assert.equal(s.slots.reduce((n,r)=>n+r.confirmed_count,0),s.analytics.summary.confirmed);
  assert.equal(s.slots.reduce((n,r)=>n+r.queue_count,0),s.analytics.summary.waitingEntries);
  for(const period of s.analytics.totals)assert.equal(period.onDuty,s.analytics.summary.rostered);
  for(const slot of s.slots)assert.ok(slot.occupied+slot.held<=slot.capacity);
  for(let i=0;i<4;i++)for(const key of ['known','temporary','total','required'])assert.equal(s.analytics.totals[i][key],s.analytics.rows.reduce((n,r)=>n+r.periods[i][key],0));
  assert.equal(s.analytics.summary.rostered,18);assert.equal(s.analytics.staffPeak.required,18);
  assert.deepEqual(s.analytics.transfers.map(m=>[m.from,m.to,m.count]),[[1,3,1],[6,4,1]]);assert.equal(s.analytics.unfilled,0);
});
test('duplicate activities for one traveller do not become duplicate known visits',t=>{
  const f=fixture(t);const before=f.snapshot().analytics;
  const other=f.service.createServiceSlot({loungeServiceId:101,date:DATE,start:'19:00',end:'19:30',capacity:1});
  f.service.createReservation(5,other.slot_id,'same-visitor-second-service');
  const after=f.snapshot().analytics;
  assert.equal(after.knownVisitors,before.knownVisitors);
  assert.equal(after.totals.reduce((n,p)=>n+p.known,0),before.totals.reduce((n,p)=>n+p.known,0));
});
test('flight simulator delay changes forecast and staff estimates from the same dataset',t=>{
  const f=fixture(t),before=f.snapshot();f.ops.delayFlight(DATE,'CX845',60);const after=f.snapshot();
  assert.notDeepEqual(after.analytics.totals,before.analytics.totals);assert.equal(after.flights.find(x=>x.number==='CX845').event.source,'mock_flight_provider');
  f.ops.delayFlight(DATE,'CX845',0);assert.deepEqual(f.snapshot().analytics.totals,before.analytics.totals);
});
test('explicit scenario reset is reproducible, retains history and does not touch unrelated slots',t=>{
  const f=fixture(t);const unrelated=f.service.createReservation(3,1008,'preserve-other-lounge');const events=f.db.prepare('SELECT count(*) AS n FROM reservation_events').get().n;
  assert.throws(()=>resetOperationsDemo(f.db,f.service,{date:DATE}),/明確確認/);
  assert.equal(resetOperationsDemo(f.db,f.service,{date:DATE,confirmed:true}).position,2);
  assert.equal(f.service.getUserReservations(3).find(r=>r.id===unrelated.id).status,'confirmed');
  assert.ok(f.db.prepare('SELECT count(*) AS n FROM reservation_events').get().n>events);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM lounges WHERE name='The Bridge'").get().n,1);
});
test('scenario reset rolls back if an existing user ID conflicts',t=>{
  const f=fixture(t,{demo:false});f.db.prepare("INSERT INTO users VALUES(5,'Existing development user','first',?)").run(new Date().toISOString());
  const before=f.db.prepare('SELECT count(*) AS n FROM reservation_events').get().n;
  assert.throws(()=>resetOperationsDemo(f.db,f.service,{date:DATE,confirmed:true}),/未覆蓋/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM reservation_events').get().n,before);assert.equal(f.service.getSlotAvailability(1001).available,1);
});
test('slot creation, capacity floor, FIFO on growth and safe removal are service operations',t=>{
  const f=fixture(t);const added=f.service.createServiceSlot({loungeServiceId:101,date:DATE,start:'18:00',end:'18:30',capacity:2});
  assert.equal(f.service.getSlotAvailability(added.slot_id).available,2);
  assert.throws(()=>f.service.createServiceSlot({loungeServiceId:101,date:DATE,start:'18:05',end:'18:35',capacity:1}),e=>e.code==='SLOT_CONFLICT');
  assert.throws(()=>f.service.createServiceSlot({loungeServiceId:102,date:DATE,start:'19:00',end:'19:30',capacity:1}),e=>e.code==='WALK_IN_ONLY');
  assert.throws(()=>f.service.createServiceSlot({loungeServiceId:101,date:DATE,start:'19:00',end:'19:10',capacity:1}),e=>e.code==='INVALID_INPUT');
  assert.throws(()=>f.service.removeServiceSlot(1001),e=>e.code==='SLOT_IN_USE');
  f.service.updateServiceSlot(1001,{capacity:2});assert.equal(f.service.getWaitlistPosition(2,1001).status,'offered');
  assert.throws(()=>f.service.updateServiceSlot(1001,{capacity:1}),e=>e.code==='CAPACITY_FLOOR');
  f.service.removeServiceSlot(added.slot_id);assert.equal(f.service.getSlotAvailability(added.slot_id).active,false);
  assert.ok(f.snapshot().slots.some(s=>s.slot_id===added.slot_id));assert.ok(!f.service.listAvailableSlots({date:DATE,includeFull:true}).some(s=>s.slot_id===added.slot_id));
});
test('admin endpoints require one-time login and reject remote origins, CSRF and wrong actor',async t=>{
  const f=await httpFixture(t);const noAuth=await fetch(f.base+'/api/ops/state?date='+DATE);assert.equal(noAuth.status,401);
  assert.equal((await f.send('/api/ops/session','POST',{token:'test-only-operator-token'})).status,401);
  assert.equal((await f.send('/api/ops/actions','POST',{action:'cancel',userId:5,reservationId:1},{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.send('/api/ops/actions','POST',{action:'cancel',userId:5,reservationId:1},{'X-Ops-Request':'0'})).status,403);
  assert.equal((await f.send('/api/ops/actions','POST',{action:'cancel',userId:5,reservationId:1})).status,403);
  assert.equal((await f.send('/api/ops/slots','POST',{loungeServiceId:101,date:DATE,start:'18:00',end:'18:30',capacity:1,extra:1})).status,400);
  const state=await f.send('/api/ops/state?date='+DATE);assert.equal(state.status,200);assert.equal((await state.json()).data.analytics.summary.occupancy,22);
});
test('full admin cancellation, FIFO decline, passenger acceptance and itinerary synchronization',async t=>{
  const f=await httpFixture(t);let current={...policy(demoState()),serviceDate:DATE,activities:demoState().currentItinerary};let html='';
  const ui=createController({context:()=>current,now:f.now,show:x=>html=x,update:activities=>current={...current,activities,journey:{...current.journey,currentItinerary:activities}},fetchImpl:(route,options)=>fetch(f.base+route,options)});
  await ui.open();const a=f.service.getWaitlistPosition(1,1001);assert.equal(a.position,2);
  const owner=f.snapshot().reservations.find(r=>r.service_slot_id===1001&&r.status==='confirmed');
  assert.equal((await f.send('/api/ops/actions','POST',{action:'cancel',userId:owner.user_id,reservationId:owner.id})).status,200);
  const first=f.service.getWaitlistPosition(2,1001);assert.equal(first.status,'offered');assert.equal(f.service.getWaitlistPosition(1,1001).position,1);
  assert.equal((await f.send('/api/ops/actions','POST',{action:'leave',userId:2,entryId:first.id})).status,200);
  await ui.tick();assert.equal(ui.get().waitlist.find(w=>w.id===a.id).status,'offered');assert.match(html,/接受邀请/);
  assert.equal(await ui.action('accept',a.id),true);assert.equal(await ui.commit(),true);
  assert.equal(current.activities.find(x=>x.slotId===1001).status,'confirmed');
  const snapshot=(await (await f.send('/api/ops/state?date='+DATE)).json()).data;
  assert.ok(snapshot.reservations.some(r=>r.user_id===1&&r.service_slot_id===1001&&r.status==='confirmed'));
  assert.equal(snapshot.slots.find(s=>s.slot_id===1001).available,0);
});
test('expired invitations promote the next traveller without confirming them',t=>{
  const f=fixture(t),owner=f.snapshot().reservations.find(r=>r.service_slot_id===1001&&r.status==='confirmed');
  f.service.cancelReservation(owner.id,owner.user_id);const first=f.service.getWaitlistPosition(2,1001);f.advance(1100);f.service.offerAvailableSlot(1001);
  assert.equal(f.service.getWaitlistPosition(2,1001).status,'expired');assert.equal(f.service.getWaitlistPosition(1,1001).status,'offered');
  assert.throws(()=>f.service.acceptWaitlistOffer(first.id,2),e=>e.code==='OFFER_EXPIRED');
  assert.equal(f.service.getUserReservations(1).filter(r=>r.service_slot_id===1001&&r.status==='confirmed').length,0);
});
test('operator booking uses existing eligibility, duplicate checks and idempotent retry',async t=>{
  const f=await httpFixture(t,{demo:false});const body={action:'book',userId:2,slotId:1001,idempotencyKey:'ops-retry'};
  const one=await (await f.send('/api/ops/actions','POST',body)).json(),two=await (await f.send('/api/ops/actions','POST',body)).json();
  assert.equal(one.data.id,two.data.id);assert.equal(two.data.replayed,true);
  assert.equal((await f.send('/api/ops/actions','POST',{...body,idempotencyKey:'different'})).status,409);
  assert.equal((await f.send('/api/ops/actions','POST',{...body,userId:4,idempotencyKey:'ineligible'})).status,403);
});
test('concurrent operator requests cannot overbook the last unheld capacity',async t=>{
  const f=await httpFixture(t,{demo:false});const results=await Promise.all([2,1].map(userId=>f.send('/api/ops/actions','POST',{action:'book',userId,slotId:1001,idempotencyKey:'race-'+userId})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.service.getSlotAvailability(1001).occupied,1);
});
test('closed passenger panel polls status but pending draft remains untouched',async t=>{
  const f=await httpFixture(t,{demo:false});let current={...policy(demoState()),serviceDate:DATE,activities:demoState().currentItinerary},calls=0;
  const ui=createController({context:()=>current,show:()=>{},update:activities=>current={...current,activities},fetchImpl:(route,options)=>{calls++;return fetch(f.base+route,options);},uuid:()=> 'draft-stable'});
  await ui.open();await ui.action('book',1001);const before=calls;await ui.tick();assert.equal(calls,before);
  await ui.action('back',0);ui.close();await ui.tick();assert.ok(calls>before);
});
test('empty-date analytics and four native pages serve without a key or invented bookings',async t=>{
  const f=await httpFixture(t);const response=await f.send('/api/ops/state?date=2026-10-12'),s=(await response.json()).data;
  assert.equal(s.slots.length,0);assert.equal(s.analytics.summary.confirmed,0);assert.equal(s.analytics.summary.waiting,0);
  const html=await (await fetch(f.base+'/ops')).text();for(const text of ['運營概覽','客流預測','人力資源','預約處理'])assert.ok(html.includes(text));
  assert.ok(!html.includes('2024'));assert.equal((await fetch(f.base+'/ops.js')).status,200);assert.equal((await fetch(f.base+'/ops.css')).status,200);
});
test('passenger recovery flight delays are observed by the operations forecast',async t=>{
  const f=await httpFixture(t),before=f.snapshot();
  const state=demoState(),context={...policy(state),serviceDate:DATE,activities:state.currentItinerary};
  const response=await fetch(f.base+'/api/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delay',value:60,context})});
  assert.equal(response.status,200);const after=f.snapshot();assert.notEqual(after.flights[0].estimatedAt,before.flights[0].estimatedAt);assert.notDeepEqual(after.analytics.totals,before.analytics.totals);
});
test('rejected operator booking preserves expiry maintenance and the next FIFO offer',t=>{
  const f=fixture(t),owner=f.snapshot().reservations.find(r=>r.service_slot_id===1001&&r.status==='confirmed');
  f.service.cancelReservation(owner.id,owner.user_id);f.advance(1100);
  assert.throws(()=>f.ops.action('book',{userId:5,slotId:1001,idempotencyKey:'expired-ops-attempt'}),e=>e.code==='SLOT_FULL');
  assert.equal(f.service.getWaitlistPosition(2,1001).persisted_status,'expired');assert.equal(f.service.getWaitlistPosition(1,1001).persisted_status,'offered');
});
