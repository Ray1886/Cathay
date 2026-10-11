'use strict';
const {randomUUID}=require('node:crypto');
const {createJourneyState}=require('./flight-state');
const {MockFlightProvider}=require('./flight-simulator');
const {recover}=require('./recovery-engine');
const {atDate,displayTime,normalizeActivities,epoch}=require('./time');
const {journeyConstraints}=require('./travel-time');
const {toAgentProposal}=require('./proposal-adapter');
const {createSqliteRecoveryAdapter}=require('./sqlite-adapter');
function stateFromContext(context) {
  if(!context||!Array.isArray(context.activities)||context.activities.length>12)throw new Error('行程格式无效');
  const day=context.serviceDate || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const original=context.journey || {};
  const normalized=normalizeActivities(context.activities,original.plannedLoungeArrivalAt||atDate(day,context.windowStart||'17:30'));
  const last=[...normalized].filter(a=>a.type!=='gate').sort((a,b)=>epoch(a.startAt)-epoch(b.startAt)).at(-1);
  return createJourneyState({...original,flightNumber:'CX251',passengerId:'demo-user',gate:String(context.gate||original.gate||'25'),
    departureLoungeId:last?.locationId||original.departureLoungeId||'wing',
    plannedLoungeArrivalAt:original.plannedLoungeArrivalAt||atDate(day,context.windowStart||'17:30'),
    expectedLoungeArrivalAt:original.expectedLoungeArrivalAt||atDate(day,context.windowStart||'17:30'),
    scheduledDepartureAt:original.scheduledDepartureAt||atDate(day,'20:00'),
    boardingAt:original.boardingAt||atDate(day,context.boardingTime||'19:20'),boardingCutoffAt:original.boardingCutoffAt??null,
    currentItinerary:context.activities});
}
function policy(state){const constraints=journeyConstraints(state);return {journey:state,gate:state.gate,windowStart:displayTime(state.expectedLoungeArrivalAt),windowEnd:constraints.safeGateArrivalAt?displayTime(constraints.safeGateArrivalAt):'00:00',boardingTime:state.boardingAt?displayTime(state.boardingAt):'00:00',boardingBuffer:state.bufferMinutes,walkingMinutes:constraints.route.minutes,enforceTransfers:true};}
async function handleRecovery(body,reservationService) {
  const state=stateFromContext(body.context),timestamp=new Date().toISOString(),id=randomUUID();
  const provider=new MockFlightProvider({providerId:id,startVersion:state.latestEventVersion.mock_flight_provider||0});
  let event;
  if(body.action==='late') {
    const value=body.expectedArrivalAt?{expectedArrivalAt:body.expectedArrivalAt}:{delayMinutes:Number(body.value)};
    event={id,type:'PASSENGER_LATE',source:'passenger',sourceVersion:(state.latestEventVersion.passenger||0)+1,timestamp,flightNumber:state.flightNumber,passengerId:state.passengerId,previousValue:state.expectedLoungeArrivalAt,updatedValue:value,payload:{}};
  } else if(body.action==='gate')event=provider.changeGate(state,String(body.value),timestamp);
  else if(body.action==='delay')event=provider.delayDeparture(state,Number(body.value),timestamp);
  else if(body.action==='boarding')event=provider.changeBoarding(state,body.boardingAt||atDate(state.boardingAt.slice(0,10),String(body.value)),timestamp);
  else throw new Error('未知突发事件');
  const adapter=reservationService?createSqliteRecoveryAdapter(reservationService,{activities:state.currentItinerary}):{};
  const response=await recover(state,event,adapter);
  const adapted=response.result.type==='itinerary_proposal'?toAgentProposal(response.result,state.currentItinerary,policy(response.state)):null;
  if(adapted&&!adapted.compatible){response.result={...response.result,type:'infeasible',operations:[],requiresConfirmation:false,explanation:adapted.reasons.join('；')};}
  return {...response,event,proposal:adapted?.compatible?adapted.proposal:null};
}
module.exports={stateFromContext,handleRecovery,policy};
