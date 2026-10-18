'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),engine=require('../itinerary');
test('Pages build contains only static assets and supports the repository subpath',()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-pages.js')]);
  const out=path.join(root,'_site'),files=fs.readdirSync(out).sort();
  assert.deepEqual(files,['.nojekyll','app.js','assets','index.html','itinerary.js','reservation-model.js','reservation-ui.js','site-config.js','styles.css','travel-time.js']);
  const config={};vm.runInNewContext(fs.readFileSync(path.join(out,'site-config.js'),'utf8'),config);assert.equal(config.CathaySiteConfig.staticDemo,true);
  const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  for(const [,url]of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)){assert.ok(fs.existsSync(path.resolve(out,url)),url);assert.equal(new URL(url,'https://example.github.io/Cathay/').pathname.startsWith('/Cathay/'),true);}
  assert.match(html,/id="siteModeNotice"/);
});
test('static demo makes no backend requests and clearly explains unavailable operations',async()=>{
  const nodes=new Map(),storage=new Map();let requests=0;
  const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',innerHTML:'',hidden:true,classList:{add(){},remove(){},toggle(){}},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){},focus(){}});return nodes.get(selector);},querySelectorAll(){return [];}};
  const sandbox=vm.createContext({document,window:{isSecureContext:true},location:{protocol:'https:'},CathaySiteConfig:{staticDemo:true},ItineraryEngine:engine,ReservationUI:{createController(){throw Error('must not create API controller');}},fetch(){requests++;throw Error('must not fetch');},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout(){},clearTimeout(){}});
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8')+'\n;globalThis.testing={showWaitlist,openIncident,runRecovery,stageProposal,decideProposal,get:()=>({activities,messages})};',sandbox);
  const api=sandbox.testing,before=JSON.stringify(api.get().activities);
  assert.equal(document.querySelector('#siteModeNotice').hidden,false);assert.match(document.querySelector('#agentModeLabel').textContent,/网页演示/);
  await api.showWaitlist();assert.match(document.querySelector('#sheetBody').innerHTML,/不提供在线预约/);
  api.openIncident();assert.match(document.querySelector('#sheetBody').innerHTML,/需要完整服务/);
  assert.equal(await api.runRecovery('late',20),false);assert.equal(JSON.stringify(api.get().activities),before);
  assert.equal(api.stageProposal({operations:[{op:'update',id:2,start:'18:00',end:'18:30'}]}),true);
  const index=api.get().messages.length-1;assert.equal(api.decideProposal(index,'confirm'),true);assert.ok(storage.has('lounge-itinerary-v2'));assert.equal(requests,0);
});
