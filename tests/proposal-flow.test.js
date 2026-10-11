const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../itinerary.js');

const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');

function page(fetchImpl=async()=>{throw new Error('offline')}){
  const nodes=new Map(),storage=new Map();
  function node(){return {value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,scrollTop:0,scrollHeight:0,
    classList:{add(){},remove(){},toggle(){}},addEventListener(){},focus(){},showModal(){},close(){},scrollIntoView(){}}}
  const document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector)},querySelectorAll(){return []}};
  const context=vm.createContext({document,window:{isSecureContext:true},ItineraryEngine:engine,fetch:fetchImpl,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout(){},clearTimeout(){}});
  vm.runInContext(source+'\n;globalThis.testing={stageProposal,decideProposal,getActivities:()=>activities,getMessages:()=>messages,setLive:()=>{aiMode="live"},changeDinner:()=>{activities.find(item=>item.type==="dining").start="18:10"},sendMessage};',context);
  return {api:context.testing,node:selector=>document.querySelector(selector),storage};
}

const dinnerChange={explanation:'晚餐提前五分鐘，其他活動不變。',operations:[{op:'update',id:2,start:'18:00',end:'18:30'}]};

test('preview does not mutate itinerary; cancel keeps state unchanged',()=>{
  const view=page();
  assert.equal(view.api.stageProposal(dinnerChange),true);
  const index=view.api.getMessages().length-1;
  assert.equal(view.api.getActivities()[1].start,'18:05');
  assert.match(view.node('#chatLog').innerHTML,/確認並保存/);
  assert.equal(view.storage.has('lounge-itinerary-v2'),false);
  assert.equal(view.api.decideProposal(index,'cancel'),true);
  assert.equal(view.api.getActivities()[1].start,'18:05');
});

test('confirm applies and persists once; duplicate click is harmless',()=>{
  const view=page();view.api.stageProposal(dinnerChange);
  const index=view.api.getMessages().length-1;
  assert.equal(view.api.decideProposal(index,'confirm'),true);
  assert.equal(view.api.getActivities()[1].start,'18:00');
  assert.equal(JSON.parse(view.storage.get('lounge-itinerary-v2'))[1].start,'18:00');
  assert.equal(view.api.decideProposal(index,'confirm'),false);
  assert.equal(view.api.getActivities()[1].start,'18:00');
});

test('stale proposal is rejected without partial changes',()=>{
  const view=page();view.api.stageProposal(dinnerChange);
  const index=view.api.getMessages().length-1;
  view.api.changeDinner();
  assert.equal(view.api.decideProposal(index,'confirm'),false);
  assert.equal(view.api.getActivities()[1].start,'18:10');
  assert.equal(view.storage.has('lounge-itinerary-v2'),false);
});

test('AI failure leaves the original itinerary untouched',async()=>{
  const view=page();view.api.setLive();view.node('#requestInput').value='把晚餐改成18:00';
  await view.api.sendMessage();
  assert.equal(view.api.getActivities()[1].start,'18:05');
  assert.match(view.node('#chatLog').innerHTML,/DeepSeek 暫時無法連線/);
});
