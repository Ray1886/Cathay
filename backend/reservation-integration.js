'use strict';
const {planSlot}=require('../reservation-model');
const {ReservationError}=require('./reservation-rules');
function createIntentValidator(service){
  return ({action,body,userId,recordId})=>{
    let slotId=body.slotId,previousId;
    if(action==='replace'){slotId=body.newSlotId;previousId=recordId;}
    if(action==='accept')slotId=service.getUserWaitlist(userId).find(w=>w.id===recordId)?.service_slot_id;
    if(!body.context||!Array.isArray(body.context.activities))throw new ReservationError('ITINERARY_REQUIRED','请刷新并提供当前行程。',400);
    const selected=service.getSlotAvailability(slotId),result=planSlot(body.context,selected,previousId);
    if(!result.valid)throw new ReservationError('ITINERARY_CONFLICT',result.errors.join(' '),409);
    for(const row of service.getUserReservations(userId,{status:'confirmed'})){
      if(row.id===previousId||row.service_slot_id===slotId)continue;
      const booked=service.getSlotAvailability(row.service_slot_id);
      if(Date.parse(selected.start_at)<Date.parse(booked.end_at)&&Date.parse(selected.end_at)>Date.parse(booked.start_at))throw new ReservationError('BOOKING_CONFLICT','时段与已有数据库预约重叠；请先取消或换约。',409);
    }
  };
}
module.exports={createIntentValidator};
