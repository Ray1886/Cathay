(function(root,factory){
  const model=factory(typeof module==='object'&&module.exports?require('./itinerary'):root.ItineraryEngine);
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.ReservationModel=model;
})(typeof globalThis!=='undefined'?globalThis:this,function(engine){
  const locations={1:'wing',2:'pier',5:'deck'};
  const tripDate=context=>context.journey?.plannedLoungeArrivalAt?.slice(0,10)||context.serviceDate||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function planSlot(context,slot,reservationId){
    const original=context.activities||[], locationId=locations[slot.lounge_id];
    const errors=[];
    if(!locationId||!engine.SERVICES[slot.service_code]?.locations?.includes(locationId))errors.push('此数据库地点尚未接入行程路线，暂不能预约。');
    if(slot.service_date!==tripDate(context)&&!context.journey)errors.push('请选择本次旅程日期的时段。');
    const old=original.find(a=>reservationId&&a.reservationId===reservationId)||original.find(a=>a.slotId===slot.slot_id)||original.find(a=>!a.reservationId&&!a.waitlistEntryId&&a.type===slot.service_code&&a.locationId===locationId&&a.start===slot.start_time&&a.end===slot.end_time);
    const id=old?.id||Math.max(0,...original.map(a=>a.id))+1;
    const item={id,type:slot.service_code,start:slot.start_time,end:slot.end_time,startAt:slot.start_at,endAt:slot.end_at,...engine.resolveServiceLocation(slot.service_code,locationId),slotId:slot.slot_id,status:'pending'};
    const draft=old?original.map(a=>a.id===id?item:{...a}):[...original.map(a=>({...a})),item];
    if(draft.length>12)errors.push('行程最多支持 12 项活动。');
    const last=[...draft].filter(a=>a.type!=='gate').sort((a,b)=>engine.activityTimes(a,context).start-engine.activityTimes(b,context).start).at(-1);
    const walkingMinutes=engine.travel.estimate(last?.locationId||'wing',context.gate||'25').minutes;
    const policy={...context,walkingMinutes,enforceTransfers:true,originalActivities:original};
    errors.push(...engine.validateItinerary(draft,policy).errors);
    return {valid:!errors.length,errors:[...new Set(errors)],item,draft};
  }
  function reconcile(activities,reservations,waitlist,slots){
    return activities.map(a=>{
      if(!a.reservationId&&!a.waitlistEntryId)return engine.SERVICES[a.type]?.reservationRequired&&a.status==='confirmed'?{...a,status:'pending'}:{...a};
      const booking=reservations.find(r=>r.id===a.reservationId),entry=waitlist.find(w=>w.id===a.waitlistEntryId);
      const accepted=entry?.status==='accepted'?reservations.find(r=>r.id===entry.reservation_id):null;
      const active=accepted||booking,slot=slots.find(s=>s.slot_id===active?.service_slot_id);
      const matches=slot&&a.type===slot.service_code&&a.locationId===locations[slot.lounge_id]&&a.start===slot.start_time&&a.end===slot.end_time&&(!a.startAt||a.startAt===slot.start_at);
      return {...a,...(active?{reservationId:active.id}:{}),status:active?.status==='confirmed'&&matches?'confirmed':'pending',bookingState:active?.status||entry?.status||'missing'};
    });
  }
  return {locations,tripDate,planSlot,reconcile};
});
