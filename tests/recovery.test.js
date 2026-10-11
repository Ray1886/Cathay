'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {demoState}=require('../recovery/demo');
const {createJourneyState,applyDisruptionEvent}=require('../recovery/flight-state');
const {detectRecoveryImpact,recover,generateRecoveryProposal}=require('../recovery/recovery-engine');
const {MockFlightProvider}=require('../recovery/flight-simulator');
const {createMockReservationAdapter}=require('../recovery/reservation-adapter');
const {toAgentProposal}=require('../recovery/proposal-adapter');
const {epoch,iso,normalizeActivities}=require('../recovery/time');
const at=time=>'2026-10-11T'+time+':00+08:00';
function late(state,updatedValue={delayMinutes:20},overrides={}) {return {id:'late-1',type:'PASSENGER_LATE',source:'passenger',timestamp:at('17:25'),flightNumber:state.flightNumber,passengerId:state.passengerId,previousValue:null,updatedValue,payload:{baseline:'plannedLoungeArrivalAt'},...overrides};}
function providerEvent(state,type,value,overrides={}) {return {id:'flight-1',type,source:'mock_flight_provider',timestamp:at('17:25'),flightNumber:state.flightNumber,previousValue:null,updatedValue:value,payload:{},...overrides};}

test('20 分钟晚到以原计划为基线，返回影响和确认草案',async()=>{
  const state=demoState(),result=await recover(state,late(state));
  assert.equal(result.state.expectedLoungeArrivalAt,at('17:50'));
  assert.ok(result.impact.affectedActivityIds.includes(1));
  assert.equal(result.result.type,'itinerary_proposal');
  assert.equal(result.result.requiresConfirmation,true);
});
test('自定义晚到分钟及明确预计到达时间',()=>{
  const state=demoState();
  assert.equal(applyDisruptionEvent(state,late(state,{delayMinutes:7})).state.expectedLoungeArrivalAt,at('17:37'));
  assert.equal(applyDisruptionEvent(state,late(state,{expectedArrivalAt:at('18:02')})).state.expectedLoungeArrivalAt,at('18:02'));
});
test('拒绝负数、非整数、字符串、空时间及同时给两种晚到格式',()=>{
  const state=demoState();
  for(const value of [{delayMinutes:-1},{delayMinutes:1.5},{delayMinutes:'20'},{expectedArrivalAt:''},{delayMinutes:20,expectedArrivalAt:at('17:50')}]) assert.equal(applyDisruptionEvent(state,late(state,value)).status,'rejected');
});
test('重复晚到报告不把分钟累计到上次预计时间',()=>{
  const state=demoState(),first=applyDisruptionEvent(state,late(state)).state;
  const next=applyDisruptionEvent(first,late(first,{delayMinutes:30},{id:'late-2',timestamp:at('17:26')}));
  assert.equal(next.state.expectedLoungeArrivalAt,at('18:00'));
});
test('到达超过登机截止时返回不可行而不产生无效草案',async()=>{
  const state=demoState(),result=await recover(state,late(state,{expectedArrivalAt:at('19:30')}));
  assert.equal(result.result.type,'infeasible');assert.deepEqual(result.result.operations,[]);
});
test('起飞延误 30 分钟不会自动延后登机',async()=>{
  const state=demoState(),event=new MockFlightProvider().delayDeparture(state,30,at('17:25'));
  const result=await recover(state,event);
  assert.equal(result.state.estimatedDepartureAt,at('20:30'));
  assert.equal(result.state.boardingAt,at('19:20'));
  assert.equal(result.result.type,'notification');
});
test('独立更新登机时间扩大时间，但已知 cutoff 保持保守限制',async()=>{
  let state=demoState();state.boardingCutoffAt=null;
  const provider=new MockFlightProvider();
  state=(await recover(state,provider.delayDeparture(state,30,at('17:25')))).state;
  const result=await recover(state,provider.changeBoarding(state,at('19:50'),at('17:26')));
  assert.equal(result.impact.availableTimeDeltaMinutes,30);assert.equal(result.result.type,'notification');
  const conservative=await recover(demoState(),providerEvent(demoState(),'BOARDING_TIME_CHANGED',at('19:50')));
  assert.equal(conservative.impact.constraints.safeLoungeDepartureAt,at('19:05'));
});
test('登机口 25 到 65 增加步行时间，改为 18:45 离开',async()=>{
  const state=demoState(),result=await recover(state,providerEvent(state,'GATE_CHANGED','65'));
  assert.equal(result.impact.constraints.route.minutes,25);
  assert.equal(result.impact.constraints.safeLoungeDepartureAt,at('18:45'));
  assert.ok(result.result.operations.some(op=>op.id===4&&op.startAt===at('18:45')));
  assert.ok(result.result.operations.some(op=>op.id===3&&op.op==='remove'));
});
test('登机口变近时更新步行时长，保留其他活动',async()=>{
  const state=demoState(),result=await recover(state,providerEvent(state,'GATE_CHANGED','6'));
  assert.equal(result.impact.constraints.route.minutes,5);
  assert.deepEqual(result.result.operations.map(op=>op.id),[4]);
});
test('未知路线不通过闸口数字差编造距离',async()=>{
  const state=demoState(),result=await recover(state,providerEvent(state,'GATE_CHANGED','99'));
  assert.equal(result.impact.constraints.route.status,'unavailable');
  assert.equal(result.result.type,'infeasible');
});
test('无影响事件只通知，不重新生成行程',async()=>{
  const state=demoState(),result=await recover(state,late(state,{delayMinutes:0}));
  assert.equal(result.result.type,'notification');assert.deepEqual(result.result.operations,[]);
});
test('检测重叠、错误时长、错误地点和重复 ID',()=>{
  const state=demoState(),items=structuredClone(state.currentItinerary);
  items[1].startAt=at('17:50');items[1].venue='错误地点';
  const impact=detectRecoveryImpact(state,items);
  for(const code of ['OVERLAP','INVALID_DURATION','INVALID_LOCATION']) assert.ok(impact.reasons.some(r=>r.code===code));
  assert.throws(()=>createJourneyState({...state,currentItinerary:[items[0],items[0]]}),/ID/);
});
test('恢复保留未受影响活动的完整对象和 ID',async()=>{
  const state=demoState(),result=await recover(state,late(state));
  assert.deepEqual(result.result.draft.find(item=>item.id===2),state.currentItinerary[1]);
  assert.deepEqual(result.result.draft.find(item=>item.id===3),state.currentItinerary[2]);
});
test('重叠时优先保留可行的已确认预订',async()=>{
  const state=demoState();state.currentItinerary[1].status='confirmed';
  state.currentItinerary[0].startAt=at('17:50');state.currentItinerary[0].endAt=at('18:20');
  const result=await recover(state,late(state,{delayMinutes:0}));
  assert.equal(result.result.draft.find(item=>item.id===2).status,'confirmed');
  assert.ok(!result.result.operations.some(op=>op.id===2));
});
test('受影响的已确认服务移除时提醒真实预订不会自动取消',async()=>{
  const state=demoState();state.currentItinerary[0].status='confirmed';state.currentItinerary[0].reservationId='booking-1';
  const result=await recover(state,late(state));
  assert.equal(result.result.affectedReservations[0].reservationId,'booking-1');
  assert.equal(result.result.affectedReservations[0].bookingCommitted,false);
  assert.ok(result.result.warnings.some(w=>w.includes('不会取消真实预订')));
});
test('仅使用适配器核实的空位，改期预订降为 pending',async()=>{
  const state=demoState();state.currentItinerary[0].status='confirmed';state.currentItinerary=state.currentItinerary.filter(item=>item.type!=='dining');
  const adapter=createMockReservationAdapter({slots:[{loungeServiceId:'shower',locationId:'wing',startAt:at('17:50'),endAt:at('18:20'),available:true}]});
  const result=await recover(state,late(state),adapter);
  assert.ok(result.result.operations.some(op=>op.id===1&&op.op==='update'));
  assert.equal(result.result.draft.find(item=>item.id===1).status,'pending');
});
test('无法核实的空位不会被采纳',async()=>{
  const state=demoState();state.currentItinerary=state.currentItinerary.filter(item=>item.type!=='dining');
  const adapter=createMockReservationAdapter({slots:[{loungeServiceId:'shower',locationId:'wing',startAt:at('17:50'),endAt:at('18:20'),available:false}]});
  const result=await recover(state,late(state),adapter);
  assert.ok(result.result.operations.some(op=>op.id===1&&op.op==='remove'));
});
test('有核实空位时优先保住受影响已确认服务，调整冲突的未确认活动',async()=>{
  const state=demoState();state.currentItinerary[0].status='confirmed';
  const adapter=createMockReservationAdapter({slots:[
    {loungeServiceId:'shower',locationId:'wing',startAt:at('17:50'),endAt:at('18:20'),available:true},
    {loungeServiceId:'dining',locationId:'wing',startAt:at('18:20'),endAt:at('18:50'),available:true}
  ]});
  const result=await recover(state,late(state),adapter);
  assert.equal(result.result.draft.find(item=>item.id===1).startAt,at('17:50'));
  assert.equal(result.result.draft.find(item=>item.id===1).status,'pending');
  assert.ok(result.result.operations.some(op=>op.id===2));
  assert.equal(result.result.draft.find(item=>item.id===1).start,'17:50');
});
test('登机时间提前且无法步行到达时不可行',async()=>{
  const state=demoState(),result=await recover(state,providerEvent(state,'BOARDING_TIME_CHANGED',at('17:40')));
  assert.equal(result.result.type,'infeasible');
});
test('重复事件幂等，同一 ID 不同内容拒绝',async()=>{
  const state=demoState(),event=late(state),first=await recover(state,event),second=await recover(first.state,event);
  assert.equal(second.impact.eventStatus,'duplicate');assert.equal(second.state.revision,first.state.revision);
  assert.equal(second.result.type,'notification');
  assert.equal(applyDisruptionEvent(first.state,{...event,updatedValue:{delayMinutes:22}}).status,'rejected');
});
test('乱序时间及版本拒绝；不同字段独立接收更新',()=>{
  const state=demoState(),first=applyDisruptionEvent(state,providerEvent(state,'GATE_CHANGED','65',{id:'a',sourceVersion:3,timestamp:at('17:28')})).state;
  assert.equal(applyDisruptionEvent(first,providerEvent(first,'GATE_CHANGED','6',{id:'b',sourceVersion:2,timestamp:at('17:29')})).status,'stale');
  assert.equal(applyDisruptionEvent(first,providerEvent(first,'GATE_CHANGED','6',{id:'c',timestamp:at('17:27')})).status,'stale');
  assert.equal(applyDisruptionEvent(first,providerEvent(first,'BOARDING_TIME_CHANGED',at('19:30'),{id:'d',sourceVersion:2,timestamp:at('17:27')})).status,'applied');
});
test('所有输入在确认前保持原样',async()=>{
  const state=demoState(),event=late(state),snapshot=structuredClone({state,event});
  await recover(state,event);
  assert.deepEqual({state,event},snapshot);
});
test('跨午夜晚到及跨午夜服务使用香港日期而非负时间',async()=>{
  const state=createJourneyState({...demoState(),plannedLoungeArrivalAt:at('23:40'),scheduledDepartureAt:'2026-10-12T02:00:00+08:00',boardingAt:'2026-10-12T01:20:00+08:00',boardingCutoffAt:null,currentItinerary:[
    {...demoState().currentItinerary[0],startAt:at('23:50'),endAt:'2026-10-12T00:20:00+08:00'},
    {...demoState().currentItinerary[3],startAt:'2026-10-12T01:00:00+08:00',endAt:'2026-10-12T01:10:00+08:00'}]});
  const result=await recover(state,late(state,{delayMinutes:30}));
  assert.equal(result.state.expectedLoungeArrivalAt,'2026-10-12T00:10:00+08:00');
  assert.equal(result.impact.constraints.availableMinutes,50);
  assert.equal(result.result.type,'itinerary_proposal');
});
test('旧 HH:MM 按跨午夜顺序补日期，同日乱序不会被误加一天',()=>{
  const base=demoState().currentItinerary[0];
  const {startAt:unusedStart,endAt:unusedEnd,...legacy}=base;
  const midnight=normalizeActivities([{...legacy,start:'23:50',end:'00:20'},{...legacy,id:2,start:'00:30',end:'01:00'}],at('23:40'));
  assert.equal(midnight[0].endAt,'2026-10-12T00:20:00+08:00');
  assert.equal(midnight[1].startAt,'2026-10-12T00:30:00+08:00');
  const unordered=normalizeActivities([{...legacy,start:'18:00',end:'18:30'},{...legacy,id:2,start:'17:50',end:'18:20'}],at('17:30'));
  assert.equal(unordered[1].startAt,at('17:50'));
});
test('跨贵宾室衔接没有路线资料时不声称可行',async()=>{
  const state=demoState();state.currentItinerary[1]={...state.currentItinerary[1],type:'rest',locationId:'deck',venue:'玲瓏堂',endAt:at('18:25'),end:'18:25'};
  const adapter=createMockReservationAdapter({slots:[{loungeServiceId:'rest',locationId:'deck',startAt:at('18:05'),endAt:at('18:25'),available:true}]});
  const result=await recover(state,late(state,{delayMinutes:0}),adapter);
  assert.equal(result.result.type,'infeasible');
});
test('相同输入产生确定性输出',async()=>{
  const state=demoState(),event=providerEvent(state,'GATE_CHANGED','65');
  assert.deepEqual(await recover(state,event),await recover(state,event));
});
test('拒绝伪造聊天来源航班事件、无关航班及缺字段事件',()=>{
  const state=demoState();
  for(const event of [providerEvent(state,'GATE_CHANGED','65',{source:'passenger'}),providerEvent(state,'GATE_CHANGED','65',{flightNumber:'CX999'}),{id:'broken'}]) assert.equal(applyDisruptionEvent(state,event).status,'rejected');
});
test('拒绝无效日历日期及无时区时间，支持 UTC',()=>{
  assert.throws(()=>epoch('2026-02-30T17:30:00+08:00'));
  assert.throws(()=>epoch('2026-10-11T17:30:00'));
  assert.equal(iso(epoch('2026-10-11T09:30:00Z')),at('17:30'));
});
test('未知登机时间保守不可行，不从起飞时间推测',async()=>{
  const state=createJourneyState({...demoState(),boardingAt:null,boardingCutoffAt:null});
  const result=await recover(state,late(state));assert.equal(result.result.type,'infeasible');
});
test('提案绑定状态与行程签名，拒绝过期草案',async()=>{
  const state=demoState(),impact=detectRecoveryImpact(state,state.currentItinerary,late(state));
  const next=structuredClone(impact.updatedState);next.gate='65';
  const result=await generateRecoveryProposal(next,state.currentItinerary,impact);
  assert.equal(result.type,'infeasible');assert.match(result.explanation,/已改变/);
});
test('现有 Agent 适配器支持同日草案，明确拒绝长步行草案',async()=>{
  const state=demoState(),result=await recover(state,late(state));
  const context={windowStart:'17:50',windowEnd:'19:15',boardingTime:'19:20',boardingBuffer:10};
  const adapted=toAgentProposal(result.result,state.currentItinerary,context);
  assert.equal(adapted.compatible,true);assert.equal(adapted.proposal.operations[0].op,'remove');
  const long=await recover(state,providerEvent(state,'GATE_CHANGED','65'));
  assert.equal(toAgentProposal(long.result,state.currentItinerary,context).compatible,false);
});
test('模拟提供者支持订阅取消及恢复快照',async()=>{
  const state=demoState(),provider=new MockFlightProvider(),events=[];
  const stop=provider.subscribe(event=>events.push(event));
  const changed=await recover(state,provider.changeGate(state,'65',at('17:25')));
  stop();provider.changeGate(changed.state,'6',at('17:26'));
  assert.equal(events.length,1);
  let restored=changed.state;
  for(const event of provider.restore(restored,state,at('17:27'))) restored=applyDisruptionEvent(restored,event).state;
  assert.equal(restored.gate,'25');assert.equal(restored.boardingAt,state.boardingAt);
});
test('服务不可用和贵宾室关闭影响相应活动',async()=>{
  const state=demoState();
  const service=await recover(state,providerEvent(state,'SERVICE_UNAVAILABLE','massage'));
  assert.ok(service.result.operations.some(op=>op.id===3&&op.op==='remove'));
  const closed=await recover(state,providerEvent(state,'LOUNGE_CLOSED','wing'));
  assert.equal(closed.result.draft.filter(item=>item.type!=='gate').length,0);
});
test('适配器失败仍不编造空位或改变原预订',async()=>{
  const state=demoState();state.currentItinerary[0].status='confirmed';
  const adapter={async getUserReservations(){throw new Error('offline');},async listAlternativeSlots(){throw new Error('offline');},async checkSlotAvailability(){throw new Error('offline');}};
  const result=await recover(state,late(state),adapter);
  assert.equal(result.result.type,'itinerary_proposal');assert.ok(result.result.warnings.some(w=>w.includes('失败')));
  assert.equal(state.currentItinerary[0].status,'confirmed');
});
