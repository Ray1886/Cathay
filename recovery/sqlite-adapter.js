'use strict';
const {serviceRules}=require('./recovery-rules');
const {epoch,date}=require('./time');
// 已存在的数据库模块仅作读取；用户身份由服务端绑定，不能由请求覆盖。
function createSqliteRecoveryAdapter(service,{userId=1,activities=[]}={}) {
  const locationIds={wing:1,pier:2,deck:5};
  const serviceIds=new Map();
  function rows(type,locationId,startAt) {
    if(!locationIds[locationId])return [];
    return service.listAvailableSlots({userId,serviceCode:type,loungeId:locationIds[locationId],date:date(startAt),includeFull:true});
  }
  return {
    async getUserReservations(){return service.getUserReservations(userId).map(row=>({id:row.id,activityId:activities.find(a=>a.reservationId===row.id)?.id,status:row.status}));},
    async getServiceRules(serviceId){const item=activities.find(a=>(a.loungeServiceId||a.type)===serviceId);const rule=serviceRules(item?.type||serviceId,item?.locationId);return rule?{durationMinutes:rule.duration,reservationRequired:rule.reservationRequired}:null;},
    async listAlternativeSlots(filters){
      const item=activities.find(a=>(a.loungeServiceId||a.type)===filters.loungeServiceId),type=item?.type||filters.loungeServiceId;
      const result=rows(type,filters.locationId,filters.startAt).filter(row=>row.direct_bookable&&epoch(row.start_at)>=epoch(filters.startAt)&&epoch(row.end_at)<=epoch(filters.endAt));
      for(const row of result)serviceIds.set(filters.loungeServiceId+'|'+row.start_at+'|'+row.end_at,row.slot_id);
      return result.map(row=>({loungeServiceId:filters.loungeServiceId,locationId:filters.locationId,startAt:row.start_at,endAt:row.end_at,slotId:row.slot_id,available:true}));
    },
    async checkSlotAvailability(serviceId,startAt,endAt){const slotId=serviceIds.get(serviceId+'|'+startAt+'|'+endAt);return {available:slotId?Boolean(service.getSlotAvailability(slotId).direct_bookable):false,source:'sqlite-demo'};}
  };
}
module.exports={createSqliteRecoveryAdapter};
