'use strict';
const {serviceRules} = require('./recovery-rules');
function createMockReservationAdapter({reservations=[],slots=[]}={}) {
  const data=structuredClone({reservations,slots});
  return {
    async getUserReservations(userId) {return structuredClone(data.reservations.filter(r=>r.userId===userId));},
    async checkSlotAvailability(loungeServiceId,startAt,endAt) {return {available:data.slots.some(s=>s.loungeServiceId===loungeServiceId&&s.startAt===startAt&&s.endAt===endAt&&s.available===true),source:'mock'};},
    async getServiceRules(serviceId) {const rule=serviceRules(serviceId);return rule?{durationMinutes:rule.duration,reservationRequired:rule.reservationRequired}:null;},
    async listAlternativeSlots(filters) {return structuredClone(data.slots.filter(s=>s.loungeServiceId===filters.loungeServiceId&&s.locationId===filters.locationId&&s.available===true));}
  };
}
module.exports = {createMockReservationAdapter};
