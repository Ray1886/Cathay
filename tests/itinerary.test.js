const test = require('node:test');
const assert = require('node:assert/strict');
const { applyProposalToDraft, validateItinerary, diffItineraries, resolveServiceLocation, SERVICES, DEMO_AVAILABILITY } = require('../itinerary.js');

function fixture(){return [
  {id:1,type:'shower',start:'17:30',end:'18:00',venue:'寰宇堂頭等貴賓室',status:'added'},
  {id:2,type:'dining',start:'18:05',end:'18:35',venue:'寰宇堂頭等貴賓室',status:'added'},
  {id:3,type:'massage',start:'18:40',end:'18:55',venue:'寰宇堂頭等貴賓室',status:'pending'},
  {id:4,type:'gate',start:'19:00',end:'19:10',venue:'步行約 10 分鐘',status:'none'}
]}

test('moves dinner while preserving all unaffected activities and input state',()=>{
  const original=fixture(),draft=applyProposalToDraft(original,[{op:'update',id:2,start:'18:00',end:'18:30'}]);
  assert.equal(original[1].start,'18:05');
  assert.equal(draft[1].start,'18:00');
  assert.deepEqual(draft.filter(item=>item.id!==2),original.filter(item=>item.id!==2));
  assert.equal(validateItinerary(draft).valid,true);
  assert.deepEqual(diffItineraries(original,draft).map(change=>change.kind),['updated']);
});

test('adds rest after dinner and removes massage in one proposal',()=>{
  const original=fixture();
  const draft=applyProposalToDraft(original,[{op:'remove',id:3},{op:'add',type:'rest',start:'18:40',end:'19:00'}]);
  assert.equal(draft.some(item=>item.id===3),false);
  assert.equal(draft.find(item=>item.type==='rest').id,5);
  assert.equal(draft.find(item=>item.type==='gate').id,4);
  assert.equal(validateItinerary(draft).valid,true);
  assert.deepEqual(diffItineraries(original,draft).map(change=>change.kind),['removed','added']);
});

test('rejects overlap, invalid time, unknown type, unknown id and gate removal',()=>{
  const original=fixture();
  const overlap=applyProposalToDraft(original,[{op:'add',type:'rest',start:'18:20',end:'18:40'}]);
  assert.equal(validateItinerary(overlap).valid,false);
  assert.throws(()=>applyProposalToDraft(original,[{op:'add',type:'rest',start:'25:00',end:'25:20'}]),/時間/);
  assert.throws(()=>applyProposalToDraft(original,[{op:'add',type:'pool',start:'18:35',end:'18:55'}]),/未知活動/);
  assert.throws(()=>applyProposalToDraft(original,[{op:'remove',id:99}]),/活動 ID/);
  assert.throws(()=>applyProposalToDraft(original,[{op:'remove',id:4}]),/登機口/);
});

test('boarding buffer and service duration constraints reject impossible plan',()=>{
  const original=fixture();
  const lateGate=applyProposalToDraft(original,[{op:'update',id:4,start:'19:05',end:'19:15'}]);
  assert.equal(validateItinerary(lateGate).valid,false);
  const longMassage=applyProposalToDraft(original,[{op:'update',id:3,start:'18:30',end:'19:30'}]);
  assert.equal(validateItinerary(longMassage).valid,false);
});

test('an earlier lounge arrival permits an earlier service without changing the gate deadline',()=>{
  const draft=applyProposalToDraft(fixture(),[{op:'update',id:1,start:'16:30',end:'17:00'}]);
  assert.equal(validateItinerary(draft).valid,false);
  assert.equal(validateItinerary(draft,{windowStart:'16:00'}).valid,true);
  assert.equal(draft.find(item=>item.type==='gate').end,'19:10');
});

test('changed confirmed reservation requires reconfirmation; removed booking is warned',()=>{
  const original=fixture();original[2].status='confirmed';
  const moved=applyProposalToDraft(original,[{op:'update',id:3,start:'18:35',end:'18:50'}]);
  assert.equal(moved[2].status,'pending');
  assert.match(validateItinerary(moved,{originalActivities:original}).warnings[0],/重新確認/);
  const removed=applyProposalToDraft(original,[{op:'remove',id:3}]);
  assert.match(validateItinerary(removed,{originalActivities:original}).warnings[0],/不會自動取消/);
});

test('selects real lounge facilities and limits massage to supported lounges',()=>{
  assert.equal(resolveServiceLocation('shower','bridge').venue,'逸連堂');
  assert.equal(resolveServiceLocation('shower','bridge').area,'淋浴室');
  assert.deepEqual(SERVICES.massage.locations,['wing','pier']);
  const added=applyProposalToDraft(fixture(),[{op:'add',type:'rest',locationId:'pier',start:'18:35',end:'18:55'}]);
  assert.equal(added.at(-1).venue,'玉衡堂頭等貴賓室');
});

test('demo availability only contains reservable shower and massage slots',()=>{
  assert.deepEqual([...new Set(DEMO_AVAILABILITY.slots.map(slot=>slot.type))].sort(),['massage','shower']);
  assert.ok(DEMO_AVAILABILITY.slots.every(slot=>slot.locationId));
});
