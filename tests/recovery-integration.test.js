'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAppServer}=require('../server'),{demoState}=require('../recovery/demo'),{policy}=require('../recovery/integration');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),engine=require('../itinerary');
const {openDatabase}=require('../backend/db'),{seedDatabase}=require('../database/seed'),{createReservationService}=require('../backend/reservation-service'),{createSqliteRecoveryAdapter}=require('../recovery/sqlite-adapter');
function context(state=demoState()){return {...policy(state),serviceDate:'2026-10-11',activities:state.currentItinerary};}
async function app(t,options={}){const server=createAppServer(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;return async(route,body,headers={})=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};}
test('main API previews without mutation, confirms 25-minute gate and replays approval',async t=>{
  const post=await app(t),preview=await post('/api/recovery',{action:'gate',value:'65',context:context()});
  assert.equal(preview.status,200);assert.equal(preview.body.proposal.type,'itinerary_proposal');assert.equal(preview.body.state.currentItinerary.at(-1).start,'19:00');
  const next=context(preview.body.state),confirmed=await post('/api/recovery/confirm',{previewId:preview.body.previewId,context:next});
  assert.equal(confirmed.status,200);assert.equal(confirmed.body.draft.at(-1).start,'18:45');assert.equal(confirmed.body.bookingCommitted,false);
  assert.deepEqual((await post('/api/recovery/confirm',{previewId:preview.body.previewId,context:next})).body,confirmed.body);
});
test('changed activities invalidate recovery approval',async t=>{
  const post=await app(t),preview=await post('/api/recovery',{action:'gate',value:'65',context:context()});
  const changed=context(preview.body.state);changed.activities[1].start='18:06';changed.activities[1].startAt='2026-10-11T18:06:00+08:00';
  assert.equal((await post('/api/recovery/confirm',{previewId:preview.body.previewId,context:changed})).status,409);
});
test('late updates retain planned baseline and departure delay leaves boarding unchanged',async t=>{
  const post=await app(t),first=await post('/api/recovery',{action:'late',value:20,context:context()});
  const second=await post('/api/recovery',{action:'late',value:30,context:context(first.body.state)});
  assert.equal(second.body.state.expectedLoungeArrivalAt,'2026-10-11T18:00:00+08:00');
  const delayed=await post('/api/recovery',{action:'delay',value:30,context:context()});assert.equal(delayed.body.state.boardingAt,'2026-10-11T19:20:00+08:00');assert.equal(delayed.body.result.type,'notification');
});
test('unknown routes and malformed events do not produce unsafe proposals; cross origin denied',async t=>{
  const post=await app(t),unknown=await post('/api/recovery',{action:'gate',value:'99',context:context()});assert.equal(unknown.body.result.type,'infeasible');
  const invalid=await post('/api/recovery',{action:'late',value:-2,context:context()});assert.equal(invalid.body.impact.eventStatus,'rejected');
  assert.equal((await post('/api/recovery',{action:'late',value:20,context:context()},{Origin:'https://example.com'})).status,403);
});
test('cross-midnight recovery preserves dates through validation and confirmation',async t=>{
  const state=demoState();state.boardingAt='2026-10-12T01:20:00+08:00';state.boardingCutoffAt=null;state.plannedLoungeArrivalAt=state.expectedLoungeArrivalAt='2026-10-11T23:40:00+08:00';
  state.currentItinerary=[{...state.currentItinerary[0],start:'23:50',end:'00:20',startAt:'2026-10-11T23:50:00+08:00',endAt:'2026-10-12T00:20:00+08:00'},{...state.currentItinerary[3],start:'01:00',end:'01:10',startAt:'2026-10-12T01:00:00+08:00',endAt:'2026-10-12T01:10:00+08:00'}];
  const post=await app(t),preview=await post('/api/recovery',{action:'late',value:30,context:context(state)});assert.equal(preview.body.proposal.type,'itinerary_proposal');
  const confirmed=await post('/api/recovery/confirm',{previewId:preview.body.previewId,context:context(preview.body.state)});assert.equal(confirmed.status,200);assert.equal(confirmed.body.draft[0].startAt,'2026-10-12T01:00:00+08:00');
});
test('DeepSeek explains deterministic recovery without tools or exposing credentials',async t=>{
  let payload;const post=await app(t,{apiKey:'test-secret',fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer test-secret');return {ok:true,json:async()=>({choices:[{message:{content:'请确认草案，步行是虚构示范。'}}]})};}});
  const preview=await post('/api/recovery',{action:'gate',value:'65',context:context()}),reply=await post('/api/recovery/explain',{previewId:preview.body.previewId});
  assert.equal(reply.body.reply,'请确认草案，步行是虚构示范。');assert.equal(payload.tools,undefined);assert.equal(JSON.stringify(reply).includes('test-secret'),false);
});
test('SQLite adapter reads eligible inventory without writing reservation events',async t=>{
  const db=openDatabase();t.after(()=>db.close());seedDatabase(db,{date:'2026-10-11'});const service=createReservationService({db,clock:()=>new Date('2026-10-11T09:00:00Z')}),before=db.prepare('SELECT count(*) AS n FROM reservation_events').get().n;
  const adapter=createSqliteRecoveryAdapter(service,{activities:demoState().currentItinerary}),slots=await adapter.listAlternativeSlots({loungeServiceId:'massage',locationId:'wing',startAt:'2026-10-11T18:00:00+08:00',endAt:'2026-10-11T19:00:00+08:00'});
  assert.equal(slots.length,1);assert.equal((await adapter.checkSlotAvailability('massage',slots[0].startAt,slots[0].endAt)).available,true);assert.equal(db.prepare('SELECT count(*) AS n FROM reservation_events').get().n,before);
});
function page(fetchImpl){const nodes=new Map(),storage=new Map();const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},focus(){},showModal(){},close(){},scrollIntoView(){}});return nodes.get(selector);},querySelectorAll(){return [];}};const sandbox=vm.createContext({document,window:{isSecureContext:true},ItineraryEngine:engine,LoungeTravelTimes:engine.travel,fetch:fetchImpl,setTimeout(){},clearTimeout(){},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8')+'\n;globalThis.api={runRecovery,decideProposal,get:()=>({activities,messages,recoveryJourney}),change:()=>{activities[1].start="18:06"}};',sandbox);return {api:sandbox.api,storage};}
test('main UI preserves itinerary before confirmation and after cancel; confirmation saves recovery',async t=>{
  const post=await app(t),view=page(async(route,options)=>{const result=await post(route.replace('./','/'),JSON.parse(options.body));return {ok:result.status===200,json:async()=>result.body};});
  await view.api.runRecovery('gate','65');let state=view.api.get(),index=state.messages.length-1;
  assert.equal(state.activities.at(-1).start,'19:00');assert.equal(state.recoveryJourney.gate,'65');assert.equal(state.messages[index].proposal.status,'pending');
  view.api.decideProposal(index,'cancel');assert.equal(view.api.get().activities.at(-1).start,'19:00');
  await view.api.runRecovery('gate','65');index=view.api.get().messages.length-1;
  assert.equal(await view.api.decideProposal(index,'confirm'),true);assert.equal(view.api.get().activities.at(-1).start,'18:45');assert.ok(view.storage.has('lounge-recovery-journey-v1'));
});
test('main UI rejects recovery response when itinerary changes during the request',async t=>{
  const post=await app(t);let resolve;const view=page(async(route,options)=>{const result=await post(route.replace('./','/'),JSON.parse(options.body));await new Promise(done=>{resolve=done;});return {ok:true,json:async()=>result.body};});
  const running=view.api.runRecovery('gate','65');while(!resolve)await new Promise(done=>setImmediate(done));view.api.change();resolve();assert.equal(await running,false);assert.equal(view.api.get().recoveryJourney,null);
});
