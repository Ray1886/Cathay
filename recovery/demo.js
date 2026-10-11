'use strict';
const {SERVICES} = require('../itinerary');
const {createJourneyState} = require('./flight-state');
const {MockFlightProvider} = require('./flight-simulator');
const {recover} = require('./recovery-engine');
function demoState() {
  const times=[['shower','17:30','18:00'],['dining','18:05','18:35'],['massage','18:40','18:55'],['gate','19:00','19:10']];
  return createJourneyState({flightNumber:'CX251',passengerId:'demo-user',departureLoungeId:'wing',gate:'25',scheduledDepartureAt:'2026-10-11T20:00:00+08:00',boardingAt:'2026-10-11T19:20:00+08:00',boardingCutoffAt:'2026-10-11T19:25:00+08:00',plannedLoungeArrivalAt:'2026-10-11T17:30:00+08:00',currentItinerary:times.map(([type,start,end],index)=>({id:index+1,type,start,end,locationId:SERVICES[type].locationId,venue:SERVICES[type].venue,status:type==='gate'?'none':type==='massage'?'pending':'added'}))});
}
async function demo() {
  const state=demoState(),provider=new MockFlightProvider();
  const event=provider.changeGate(state,'65','2026-10-11T17:25:00+08:00');
  const {impact,result}=await recover(state,event);
  return {event,stateUpdate:impact.stateUpdate,impact:{type:impact.impactType,affectedActivityIds:impact.affectedActivityIds,constraints:impact.constraints},result};
}
if(require.main===module) demo().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={demoState,demo};
