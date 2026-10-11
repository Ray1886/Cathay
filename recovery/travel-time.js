'use strict';
const {epoch,iso,MINUTE} = require('./time');
// 完全虚构的原型样本，不代表香港机场距离或实际步行时间。
const shared = require('../travel-time');
const SYNTHETIC_ROUTES = Object.freeze({wing:Object.freeze({'25':10,'31':15,'65':25,'6':5}),deck:Object.freeze({'25':12,'31':17,'65':20,'6':3})});
function estimateTravelTime(loungeId, gate) {
  return shared.estimate(loungeId,gate);
}
function journeyConstraints(state) {
  const route = estimateTravelTime(state.departureLoungeId,state.gate);
  const deadlines = [state.boardingAt,state.boardingCutoffAt].filter(Boolean).map(epoch);
  const deadline = deadlines.length?Math.min(...deadlines):null;
  const safeGateArrival = deadline === null?null:deadline - state.bufferMinutes*MINUTE;
  const departure = route.minutes === null || safeGateArrival === null?null:safeGateArrival-route.minutes*MINUTE;
  return {route,boardingDeadlineAt:deadline === null?null:iso(deadline),safeGateArrivalAt:safeGateArrival === null?null:iso(safeGateArrival),safeLoungeDepartureAt:departure === null?null:iso(departure),expectedLoungeArrivalAt:state.actualLoungeArrivalAt || state.expectedLoungeArrivalAt,availableMinutes:departure === null?null:(departure-epoch(state.actualLoungeArrivalAt || state.expectedLoungeArrivalAt))/MINUTE};
}
module.exports = {SYNTHETIC_ROUTES,estimateTravelTime,journeyConstraints};
