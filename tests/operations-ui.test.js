'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {openDatabase}=require('../backend/db'),{seedDatabase}=require('../database/seed');
const {createReservationService}=require('../backend/reservation-service'),{createOperationsService}=require('../backend/operations-service');
const {resetOperationsDemo}=require('../database/operations-demo');
async function uiFixture(t,{empty=false,protocol='http:'}={}){
  const db=openDatabase();t.after(()=>db.close());seedDatabase(db,{date:'2026-10-11'});const service=createReservationService({db});resetOperationsDemo(db,service,{date:'2026-10-11',confirmed:true});
  const data=createOperationsService({db,service}).snapshot(empty?'2026-10-12':'2026-10-11');
  const elements=new Map(),events={},calls=[];
  function element(id){if(!elements.has(id))elements.set(id,{id,value:'',innerHTML:'',textContent:'',hidden:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;},matches(){return false;}});return elements.get(id);}
  const nav=['overview','traffic','staff','bookings'].map(page=>Object.assign(element('nav-'+page),{dataset:{page}}));
  const document={getElementById:element,querySelectorAll:selector=>selector==='[data-page]'?nav:[],addEventListener:(name,fn)=>events[name]=fn,activeElement:null};
  const code=fs.readFileSync(path.join(__dirname,'../ops.js'),'utf8');
  vm.runInNewContext(code,{document,location:{hash:'',pathname:'/ops',protocol},history:{replaceState(){}},fetch:async(route,options)=>{calls.push({route,options});return {ok:true,json:async()=>({data})};},URLSearchParams,AbortSignal,Date,Intl,crypto:require('node:crypto').webcrypto,setInterval(){},setTimeout(){},console});
  await new Promise(setImmediate);
  return {data,element,nav,events,calls,click:async(name,id='')=>{events.click({target:{closest:()=>({dataset:{action:name,id}})}});await new Promise(setImmediate);}};
}
test('four-page navigation renders distinct content with Traditional Chinese and no header clock',async t=>{
  const f=await uiFixture(t);assert.match(f.element('content').innerHTML,/今日重點/);assert.doesNotMatch(f.element('content').innerHTML,/預約時段處理/);
  for(const [page,title,feature] of [['traffic','客流預測','整體客流預測'],['staff','人力資源','調度建議'],['bookings','預約處理','預約時段處理'],['overview','運營概覽','各堂狀態']]){
    f.nav.find(n=>n.dataset.page===page).listeners.click();assert.equal(f.element('pageTitle').textContent,title);assert.match(f.element('content').innerHTML,new RegExp(feature));
  }
  const header=fs.readFileSync(path.join(__dirname,'../ops.html'),'utf8').split('<header>')[1].split('</header>')[0];assert.doesNotMatch(header,/\d{1,2}:\d{2}|clock|setInterval/);
});
test('forecast lounge filter keeps SVG values and displayed total row aligned',async t=>{
  const f=await uiFixture(t);f.nav[1].listeners.click();f.events.change({target:{id:'forecastLounge',value:'3'}});
  const html=f.element('content').innerHTML,row=f.data.analytics.rows.find(r=>r.loungeId===3);
  for(const p of row.periods)assert.ok(html.includes(`${p.hour}:00–${p.hour+1}:00 · 含臨時到訪 ${p.total} 人次`));
  assert.ok(html.includes('<td>總到訪人次</td>'+row.periods.map(p=>'<td>'+p.total+'</td>').join('')));
});
test('manual booking selects an existing user and requires preview confirmation before any POST',async t=>{
  const f=await uiFixture(t);f.nav[3].listeners.click();f.element('manualUser').value='2';f.events.change({target:{id:'manualSlot',value:'1005'}});
  const before=f.calls.filter(c=>c.options.method==='POST').length;await f.click('manual-book');
  assert.equal(f.element('actionDialog').open,true);assert.match(f.element('dialogBody').innerHTML,/示範旅客 B/);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,before);
  await f.element('confirmDialog').listeners.click();await new Promise(setImmediate);
  const write=f.calls.find(c=>c.route==='/api/ops/actions');const body=JSON.parse(write.options.body);assert.equal(body.userId,2);assert.equal(body.slotId,1005);assert.ok(body.idempotencyKey);
});
test('empty-date UI renders navigable zero reservation state and an empty table',async t=>{
  const f=await uiFixture(t,{empty:true});f.nav[3].listeners.click();const html=f.element('content').innerHTML;
  assert.match(html,/目前沒有符合條件的記錄/);assert.doesNotMatch(html,/undefined|NaN/);assert.equal(f.data.analytics.summary.confirmed,0);
});
test('direct file opening keeps sibling assets and shows launch instructions without API calls',async t=>{
  const f=await uiFixture(t,{protocol:'file:'});assert.equal(f.calls.length,0);
  assert.match(f.element('content').innerHTML,/start-operations\.cmd/);assert.equal(f.element('syncStatus').textContent,'尚未啟動本機服務');
  const html=fs.readFileSync(path.join(__dirname,'../ops.html'),'utf8');
  for(const resource of ['ops.css','ops.js']){
    assert.ok(html.includes(`="./${resource}"`));assert.ok(fs.existsSync(path.join(__dirname,'..',resource)));
    assert.equal(new URL('./'+resource,'file:///C:/project/ops.html').pathname,'/C:/project/'+resource);
  }
});
