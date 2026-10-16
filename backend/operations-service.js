'use strict';
const {aggregate,loungeView}=require('./operations-model');
const {serviceDate,positiveId,ReservationError}=require('./reservation-rules');
const {MockFlightProvider}=require('../recovery/flight-simulator');
const {demoState}=require('../recovery/demo');
const {withTransaction}=require('./db');

const SERVICES={shower:'淋浴',massage:'按摩',rest:'休息／日間套房',work:'工作空間',dining:'用餐'};
const PASSENGERS={1:'示範旅客 A',2:'示範旅客 B',3:'示範旅客 C',4:'示範普通旅客'};
function createOperationsService({db,service,clock=()=>new Date()}) {
  let flightOverrides=new Map();
  function getFlights(date,lounges){
    const base=demoState();
    const definitions=[['CX251','departure',base.scheduledDepartureAt.slice(11,16),1,10,.55,'倫敦希斯路'],['CX845','departure','20:00',3,26,.65,'紐約'],['CX418','arrival','17:30',4,24,.65,'首爾轉機'],['CX826','arrival','16:30',2,6,.5,'多倫多轉機'],['CX710','departure','19:00',6,8,.4,'新加坡'],['CX920','departure','19:30',5,6,.4,'馬尼拉']];
    return definitions.filter(f=>lounges.some(l=>l.lounge_id===f[3])).map(([number,direction,at,loungeId,eligiblePassengers,visitProbability,route])=>{
      const scheduledAt=date+'T'+at+':00+08:00',override=flightOverrides.get(date+number);
      return {number,direction,scheduledAt,estimatedAt:override?.estimatedAt||scheduledAt,loungeId,eligiblePassengers,visitProbability,route,visitDurationMinutes:90,source:'模擬航班',event:override?.event||null};
    });
  }
  function allSlots(){return db.prepare('SELECT id FROM service_slots ORDER BY service_date,start_time,id').all().map(r=>{const slot=service.getSlotAvailability(r.id);return {...slot,display_name:SERVICES[slot.service_code]};});}
  function users(){return db.prepare('SELECT id,display_name,membership_tier FROM users ORDER BY id').all().map(u=>({...u,display_name:PASSENGERS[u.id]||u.display_name}));}
  function snapshot(date){
    db.exec('BEGIN');
    try {const result=readSnapshot(date);db.exec('COMMIT');return result;}
    catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }
  function readSnapshot(date){
    serviceDate(date);
    const order=[1,3,2,4,6,5];
    const lounges=service.listLounges().map(loungeView).sort((a,b)=>order.indexOf(a.lounge_id)-order.indexOf(b.lounge_id)),all=allSlots();
    let slots=all.filter(s=>s.service_date===date);
    const passengers=users(),records=passengers.flatMap(u=>service.getUserReservations(u.id)),queue=passengers.flatMap(u=>service.getUserWaitlist(u.id));
    const ids=new Set(slots.map(s=>s.slot_id));
    const reservations=records.filter(r=>ids.has(r.service_slot_id)),waitlist=queue.filter(w=>ids.has(w.service_slot_id));
    slots=slots.map(s=>({...s,
      confirmed_count:reservations.filter(r=>r.service_slot_id===s.slot_id&&r.status==='confirmed').length,
      queue_count:waitlist.filter(w=>w.service_slot_id===s.slot_id&&w.status==='waiting').length}));
    const flights=getFlights(date,lounges);
    const data={date,timezone:'Asia/Hong_Kong',lounges,slots,reservations,waitlist,users:passengers,flights,
      dates:[...new Set(all.map(s=>s.service_date))],catalog:lounges.flatMap(l=>service.listServices(l.lounge_id).map(s=>({...s,display_name:SERVICES[s.service_code]}))),
      events:db.prepare('SELECT * FROM reservation_events ORDER BY id DESC LIMIT 15').all(),simulation:{asOf:'16:00',label:'在場人數、航班及人力為合成示範；預約與候補來自共用 SQLite。'}};
    return {...data,analytics:aggregate(data)};
  }
  function ensureNoOverlap(userId,slotId){
    const selected=service.getSlotAvailability(slotId);
    for(const r of service.getUserReservations(userId,{status:'confirmed'})){
      if(r.service_slot_id===slotId)continue;
      const prior=service.getSlotAvailability(r.service_slot_id);
      if(selected.start_at<prior.end_at&&selected.end_at>prior.start_at)throw new ReservationError('BOOKING_CONFLICT','與此旅客的現有預約重疊。',409);
    }
  }
  function action(name,body){
    const result=withTransaction(db,()=>{
      try{return {value:performAction(name,body)};}
      catch(error){if(error instanceof ReservationError)return {error};throw error;}
    });
    if(result.error)throw result.error;
    return result.value;
  }
  function performAction(name,body){
    if(['book','join','accept'].includes(name)){
      positiveId(body.userId,'userId');
      const id=name==='accept'?service.getUserWaitlist(body.userId).find(w=>w.id===body.entryId)?.service_slot_id:body.slotId;
      positiveId(id,'slotId');ensureNoOverlap(body.userId,id);
    }
    if(name==='book')return service.createReservation(body.userId,body.slotId,body.idempotencyKey);
    if(name==='cancel')return service.cancelReservation(body.reservationId,body.userId);
    if(name==='join')return service.joinWaitlist(body.userId,body.slotId);
    if(name==='leave')return service.cancelWaitlistEntry(body.entryId,body.userId);
    if(name==='accept')return service.acceptWaitlistOffer(body.entryId,body.userId);
    if(name==='offer')return service.offerAvailableSlot(body.slotId);
    throw new ReservationError('INVALID_INPUT','未知操作。');
  }
  function delayFlight(date,number,minutes){
    serviceDate(date);
    if(!Number.isInteger(minutes)||minutes<0||minutes>180)throw new ReservationError('INVALID_INPUT','延誤須為 0 至 180 分鐘。');
    const flight=getFlights(date,service.listLounges()).find(f=>f.number===number);
    if(!flight)throw new ReservationError('INVALID_INPUT','找不到示範航班。');
    const provider=new MockFlightProvider({flightNumber:number,providerId:'ops:'+number});
    const updated=new Date(Date.parse(flight.scheduledAt)+minutes*60000).toISOString();
    const event=provider.emit('FLIGHT_DELAYED',flight.estimatedAt,updated,clock().toISOString(),{demo:true,direction:flight.direction});
    flightOverrides.set(date+number,{estimatedAt:updated,event});return event;
  }
  function observeRecovery(response){
    const state=response.state;
    if(state?.flightNumber&&state.estimatedDepartureAt)flightOverrides.set(state.scheduledDepartureAt.slice(0,10)+state.flightNumber,{estimatedAt:state.estimatedDepartureAt,event:response.event});
  }
  function resetFlights(){flightOverrides.clear();}
  return {snapshot,users,action,delayFlight,observeRecovery,resetFlights};
}
module.exports={createOperationsService};
