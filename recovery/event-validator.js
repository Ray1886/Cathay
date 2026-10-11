'use strict';
const {epoch} = require('./time');
const TYPES = ['PASSENGER_LATE','FLIGHT_DELAYED','BOARDING_TIME_CHANGED','GATE_CHANGED','SERVICE_UNAVAILABLE','LOUNGE_CLOSED'];
const SOURCES = ['passenger','mock_flight_provider','future_airline_api'];
function validateEvent(event,state) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return {valid:false,errors:['事件格式无效']};
  if (typeof event.id !== 'string' || !event.id.trim()) errors.push('事件 ID 无效');
  if (!TYPES.includes(event.type)) errors.push('未知事件类型');
  if (!SOURCES.includes(event.source)) errors.push('未知事件来源');
  try {epoch(event.timestamp);} catch (_) {errors.push('事件时间戳无效');}
  if (event.flightNumber !== state.flightNumber) errors.push('事件不属于当前航班');
  if (!Object.hasOwn(event,'previousValue') || !Object.hasOwn(event,'updatedValue')) errors.push('事件需要 previousValue 和 updatedValue');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) errors.push('事件 payload 无效');
  if (event.sourceVersion !== undefined && (!Number.isInteger(event.sourceVersion) || event.sourceVersion < 0)) errors.push('来源版本无效');
  if (event.type === 'PASSENGER_LATE') {
    if (event.source !== 'passenger' || event.passengerId !== state.passengerId) errors.push('晚到必须由当前旅客报告');
    const value = event.updatedValue;
    if (!value || typeof value !== 'object' || (Object.hasOwn(value,'delayMinutes') === Object.hasOwn(value,'expectedArrivalAt'))) errors.push('晚到需要延迟分钟或完整预计到达时间，二选一');
    else if (Object.hasOwn(value,'delayMinutes') && (!Number.isInteger(value.delayMinutes) || value.delayMinutes < 0 || value.delayMinutes > 1440)) errors.push('晚到分钟必须是 0–1440 整数');
    else if (Object.hasOwn(value,'expectedArrivalAt')) {try {if(epoch(value.expectedArrivalAt)<epoch(state.plannedLoungeArrivalAt)) errors.push('晚到时间不能早于计划到达时间');} catch (_) {errors.push('预计到达时间无效');}}
  } else if (event.source === 'passenger') errors.push('航班及设施事件必须来自模拟或未来航空数据提供者');
  if (['FLIGHT_DELAYED','BOARDING_TIME_CHANGED'].includes(event.type)) {
    try {epoch(event.updatedValue);} catch (_) {errors.push('更新时间无效');}
  }
  if (event.type === 'GATE_CHANGED' && (typeof event.updatedValue !== 'string' || !/^(?:G)?[A-Za-z0-9-]{1,12}$/.test(event.updatedValue))) errors.push('登机口无效');
  if (['SERVICE_UNAVAILABLE','LOUNGE_CLOSED'].includes(event.type) && (typeof event.updatedValue !== 'string' || !event.updatedValue.trim())) errors.push('设施事件需要服务类型或贵宾室 ID');
  return {valid:errors.length === 0,errors};
}
module.exports = {TYPES,SOURCES,validateEvent};
