'use strict';
const {epoch,iso,MINUTE,normalizeActivities,displayTime} = require('./time');
const {journeyConstraints} = require('./travel-time');
const {serviceRules} = require('./recovery-rules');
const {applyDisruptionEvent,signature} = require('./flight-state');
const travel=require('../travel-time');

function inspect(state,items,constraints=journeyConstraints(state)) {
  const reasons = [], add = (code,ids,message) => reasons.push({code,activityIds:ids,message});
  const arrival = epoch(constraints.expectedLoungeArrivalAt);
  const departure = constraints.safeLoungeDepartureAt?epoch(constraints.safeLoungeDepartureAt):null;
  const gates = items.filter(item=>item.type === 'gate');
  if (gates.length !== 1) add('INVALID_GATE',gates.map(item=>item.id),'必须保留一项前往登机口活动');
  if (departure === null) add('UNKNOWN_CONSTRAINT',[],'登机时间或步行路线未知，不能保证行程可行');
  else if (arrival > departure) add('ARRIVAL_TOO_LATE',[],'到达时间已晚于安全离开贵宾室时间');
  for (const item of items) {
    const rule = serviceRules(item.type,item.locationId), start=epoch(item.startAt),end=epoch(item.endAt);
    if (!rule) {add('UNKNOWN_ACTIVITY',[item.id],'未知活动类型');continue;}
    if (start<arrival) add('BEFORE_ARRIVAL',[item.id],'活动早于预计到达');
    const duration = item.type === 'gate'?constraints.route.minutes:rule.duration;
    if (end<=start || (duration !== null && end-start !== duration*MINUTE)) add('INVALID_DURATION',[item.id],'活动或步行时长不符');
    if (item.type !== 'gate') {
      if (departure !== null && end>departure) add('AFTER_SAFE_DEPARTURE',[item.id],'活动超过安全离开时间');
      if (item.venue !== rule.venue || (item.locationId && item.locationId !== rule.locationId)) add('INVALID_LOCATION',[item.id],'活动地点不符');
      if (item.locationId && !rule.locations.includes(item.locationId)) add('INVALID_LOCATION',[item.id],'服务不在所选贵宾室提供');
      if (state.unavailableServices.includes(item.type) || state.closedLounges.includes(item.locationId || rule.locationId)) add('VENUE_UNAVAILABLE',[item.id],'服务或贵宾室不可用');
    } else if (constraints.safeGateArrivalAt && end>epoch(constraints.safeGateArrivalAt)) add('MISSED_GATE_BUFFER',[item.id],'登机口到达时间不足缓冲');
    if (!['added','pending','confirmed','none'].includes(item.status)) add('INVALID_STATUS',[item.id],'活动状态无效');
  }
  for (let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++) {
    const a=items[i],b=items[j];
    if(epoch(a.startAt)<epoch(b.endAt)&&epoch(b.startAt)<epoch(a.endAt)) add('OVERLAP',[a.id,b.id],'活动时间重叠');
  }
  if(gates.length===1) for(const item of items) if(item.type!=='gate'&&epoch(item.endAt)>epoch(gates[0].startAt)) add('AFTER_GATE_DEPARTURE',[item.id,gates[0].id],'活动必须在前往登机口前结束');
  const chronological=items.filter(item=>item.type!=='gate').sort((a,b)=>epoch(a.startAt)-epoch(b.startAt));
  for(let i=1;i<chronological.length;i++) {
    const previous=chronological[i-1],next=chronological[i];
    const transfer=travel.transfer(previous.locationId||serviceRules(previous.type)?.locationId,next.locationId||serviceRules(next.type)?.locationId);
    if(transfer===null || epoch(next.startAt)-epoch(previous.endAt)<transfer*MINUTE) add('TRANSFER_GAP',[previous.id,next.id],'跨贵宾室衔接时间不足或路线未知');
  }
  const last=chronological.at(-1);
  if(last&&(last.locationId||serviceRules(last.type)?.locationId)!==state.departureLoungeId) add('DEPARTURE_LOCATION',[last.id],'最后活动贵宾室与步行出发地点不一致');
  return reasons;
}

// 在旧状态上应用事件并返回新状态；绝不修改调用方状态或行程。
function detectRecoveryImpact(journeyState,itinerary,event) {
  const before = journeyConstraints(journeyState);
  const result = event?applyDisruptionEvent(journeyState,event):{status:'applied',state:structuredClone(journeyState),errors:[]};
  const state = result.state, constraints=journeyConstraints(state);
  const items = normalizeActivities(itinerary,state.plannedLoungeArrivalAt);
  const reasons = result.status === 'applied'?inspect(state,items,constraints):[];
  const affectedActivityIds = [...new Set(reasons.flatMap(reason=>reason.activityIds))];
  const confirmedReservationIds = items.filter(item=>item.status==='confirmed'&&affectedActivityIds.includes(item.id)).map(item=>item.id);
  const delta = constraints.availableMinutes === null || before.availableMinutes === null?null:constraints.availableMinutes-before.availableMinutes;
  const recoveryRequired = reasons.length>0;
  return {eventStatus:result.status,eventErrors:result.errors,stateUpdate:result.stateUpdate || null,updatedState:state,
    impactType:result.status==='rejected'?'rejected':recoveryRequired?'recovery_required':delta>0?'extra_free_time':delta<0?'reduced_free_time':'no_change',
    affectedActivityIds,confirmedReservationIds,reasons,severity:reasons.some(r=>['UNKNOWN_CONSTRAINT','ARRIVAL_TOO_LATE','INVALID_GATE'].includes(r.code))?'critical':recoveryRequired?'warning':'info',
    recoveryRequired,constraints,availableTimeDeltaMinutes:delta,baseRevision:state.revision,baseSignature:signature({state,itinerary:items})};
}

async function generateRecoveryProposal(journeyState,itinerary,impact,adapters={}) {
  const state = impact.updatedState;
  const items = normalizeActivities(itinerary,state.plannedLoungeArrivalAt);
  const base = {baseRevision:state.revision,baseSignature:impact.baseSignature,operations:[],warnings:[],affectedReservations:[],requiresConfirmation:false,source:'recovery-engine'};
  const infeasible = explanation=>({...base,type:'infeasible',feasibility:'infeasible',explanation});
  if (signature(journeyState) !== signature(state) || signature({state,itinerary:items}) !== impact.baseSignature) return infeasible('状态或行程已改变，需要重新检测影响');
  if (impact.eventStatus === 'rejected') return infeasible('事件被拒绝：'+impact.eventErrors.join('；'));
  if (!impact.recoveryRequired) return {...base,type:'notification',feasibility:'unchanged',explanation:impact.impactType==='extra_free_time'?'登机约束已更新，可用时间增加；现有行程保持不变。':'无需修改行程。'};
  const constraints=journeyConstraints(state);
  if (!constraints.safeLoungeDepartureAt) return infeasible('缺少可靠的登机时间或步行路线，无法生成安全草案');
  if (constraints.availableMinutes<0) return infeasible('旅客到达已晚于安全离开时间，请直接寻求登机协助');
  const gates=items.filter(item=>item.type==='gate');
  if(gates.length!==1) return infeasible('登机口活动缺失或重复，需先修正输入');
  const gate=gates[0], walking=constraints.route.minutes*MINUTE;
  const departure=epoch(constraints.safeLoungeDepartureAt), arrival=epoch(constraints.expectedLoungeArrivalAt);
  const gateValid=epoch(gate.startAt)>=arrival && epoch(gate.endAt)<=epoch(constraints.safeGateArrivalAt) && epoch(gate.endAt)-epoch(gate.startAt)===walking;
  const draftGate=gateValid?structuredClone(gate):{...gate,startAt:iso(departure),endAt:constraints.safeGateArrivalAt,start:displayTime(iso(departure)),end:displayTime(constraints.safeGateArrivalAt),venue:'示范步行约 '+constraints.route.minutes+' 分钟'};
  const deadline=epoch(draftGate.startAt);
  const ordinary=items.filter(item=>item.type!=='gate');
  // 固定合法已确认活动和所有未受影响活动，只在剩余间隙内修复受影响活动。
  const individuallyValid=item=>inspect(state,[item,draftGate],constraints).every(reason=>['INVALID_GATE','DEPARTURE_LOCATION'].includes(reason.code));
  const fixed=[],moving=[];
  const ordered=[...ordinary].sort((a,b)=>(b.status==='confirmed')-(a.status==='confirmed') || epoch(a.startAt)-epoch(b.startAt) || a.id-b.id);
  for (const item of ordered) {
    const collides=fixed.some(other=>epoch(item.startAt)<epoch(other.endAt)&&epoch(other.startAt)<epoch(item.endAt));
    if(individuallyValid(item)&&!collides) fixed.push(structuredClone(item)); else moving.push(item);
  }
  const draft=[...fixed,draftGate], warnings=[];
  const protectedIds=new Set(fixed.filter(item=>item.status==='confirmed').map(item=>item.id));
  const processedIds=new Set();
  let reservations=[];
  try {if(adapters.getUserReservations) reservations=await adapters.getUserReservations(state.passengerId);} catch (_) {warnings.push('预订资料读取失败；不会确认或取消预订。');}
  if(!Array.isArray(reservations)) return infeasible('预订适配器返回格式无效');
  const preference=state.preferences || [];
  moving.sort((a,b)=>(b.status==='confirmed')-(a.status==='confirmed') || (preference.indexOf(a.type)<0?999:preference.indexOf(a.type))-(preference.indexOf(b.type)<0?999:preference.indexOf(b.type)) || epoch(a.startAt)-epoch(b.startAt) || a.id-b.id);
  const operations=[];
  if(!gateValid) operations.push({op:'update',id:gate.id,startAt:draftGate.startAt,endAt:draftGate.endAt});
  for(const item of moving) {
    processedIds.add(item.id);
    const rule=serviceRules(item.type,item.locationId);
    const serviceId=item.loungeServiceId || item.type;
    let candidates=[];
    const unavailable=!rule || state.unavailableServices.includes(item.type) || state.closedLounges.includes(item.locationId || rule.locationId);
    try {
      if(!unavailable && adapters.listAlternativeSlots && adapters.checkSlotAvailability) {
        const backendRule=adapters.getServiceRules?await adapters.getServiceRules(serviceId):null;
        if(backendRule && backendRule.durationMinutes !== rule.duration) warnings.push('服务时长与本地规则不一致，保守地不重新排程。');
        else candidates=await adapters.listAlternativeSlots({loungeServiceId:serviceId,locationId:rule.locationId,startAt:iso(arrival),endAt:iso(deadline),durationMinutes:rule.duration});
      }
      if(!Array.isArray(candidates)) throw new Error('invalid slots');
      candidates=[...candidates].sort((a,b)=>epoch(a.startAt)-epoch(b.startAt));
    } catch (_) {candidates=[];warnings.push('空位查询失败或返回无效；不会假定有可用时段。');}
    let replacement=null;
    for(const candidate of candidates) {
      try {
        if(candidate.loungeServiceId!==serviceId || candidate.locationId!==rule.locationId) continue;
        const start=epoch(candidate.startAt),end=epoch(candidate.endAt);
        if(start<arrival||end>deadline||end-start!==rule.duration*MINUTE) continue;
        const collisions=draft.filter(other=>start<epoch(other.endAt)&&epoch(other.startAt)<end);
        if(collisions.some(other=>other.type==='gate'||protectedIds.has(other.id)||processedIds.has(other.id)) || (collisions.length && item.status!=='confirmed')) continue;
        const availability=await adapters.checkSlotAvailability(serviceId,candidate.startAt,candidate.endAt);
        if(availability?.available!==true) continue;
        // 仅为保住已确认服务，允许其核实过的候选时段挤出未确认活动。
        for(const displaced of collisions) {
          draft.splice(draft.findIndex(other=>other.id===displaced.id),1);
          moving.push(ordinary.find(other=>other.id===displaced.id));
        }
        replacement={...item,startAt:iso(start),endAt:iso(end),start:displayTime(iso(start)),end:displayTime(iso(end)),status:item.status==='confirmed'?'pending':item.status};
        if(item.status==='confirmed') protectedIds.add(item.id);
        break;
      } catch (_) {warnings.push('候选空位无法核实，已跳过。');}
    }
    if(replacement) {draft.push(replacement);operations.push({op:'update',id:item.id,startAt:replacement.startAt,endAt:replacement.endAt});}
    else operations.push({op:'remove',id:item.id});
    if(item.status==='confirmed' || item.reservationId || reservations.some(r=>r.activityId===item.id)) {
      base.affectedReservations.push({activityId:item.id,reservationId:item.reservationId || reservations.find(r=>r.activityId===item.id)?.id || null,action:replacement?'rebook_required':'cancellation_review',bookingCommitted:false});
      warnings.push(replacement?'已确认服务改时段后需要重新确认预订。':'从草案移除服务不会取消真实预订，请另行处理。');
    }
  }
  const finalReasons=inspect(state,draft,constraints);
  if(finalReasons.length) return infeasible('无法生成满足所有约束的草案：'+finalReasons.map(r=>r.message).join('；'));
  if(!operations.length) return {...base,type:'notification',feasibility:'unchanged',explanation:'现有行程可保留。'};
  if(operations.length>12) return infeasible('修改超过当前提案接口的 12 项限制，需人工处理');
  return {...base,type:'itinerary_proposal',feasibility:'feasible',requiresConfirmation:true,operations,
    explanation:'按最新到达、登机及步行约束提出最小范围修改；保留可行的已确认服务与未受影响活动。',
    warnings:[...new Set(warnings)],draft:structuredClone(draft).sort((a,b)=>epoch(a.startAt)-epoch(b.startAt)),constraints};
}

async function recover(state,event,adapters={}) {
  const impact=detectRecoveryImpact(state,state.currentItinerary,event);
  const result=await generateRecoveryProposal(impact.updatedState,state.currentItinerary,impact,adapters);
  return {state:impact.updatedState,impact,result};
}
module.exports = {detectRecoveryImpact,generateRecoveryProposal,recover,inspect};
