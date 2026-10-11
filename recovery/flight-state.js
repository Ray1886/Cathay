'use strict';
const {createHash} = require('node:crypto');
const {epoch,iso,MINUTE,normalizeActivities} = require('./time');
const {validateEvent} = require('./event-validator');
const {DEFAULT_RULES} = require('./recovery-rules');
function createJourneyState(input) {
  const state = structuredClone(input);
  if (!state.flightNumber || !state.passengerId || !state.departureLoungeId || typeof state.gate !== 'string') throw new Error('缺少航班、旅客、贵宾室或登机口');
  for (const key of ['plannedLoungeArrivalAt','scheduledDepartureAt']) epoch(state[key]);
  for (const key of ['estimatedDepartureAt','boardingAt','boardingCutoffAt','expectedLoungeArrivalAt','actualLoungeArrivalAt','lastFlightUpdateAt']) if (state[key] != null) epoch(state[key]);
  state.expectedLoungeArrivalAt ||= state.plannedLoungeArrivalAt;
  state.estimatedDepartureAt ||= state.scheduledDepartureAt;
  state.boardingAt ??= null; state.boardingCutoffAt ??= null; state.actualLoungeArrivalAt ??= null;
  state.lastFlightUpdateAt ??= null; state.flightStatus ||= 'scheduled';
  state.timezone = 'Asia/Hong_Kong'; state.revision ??= 0;
  state.bufferMinutes ??= DEFAULT_RULES.bufferMinutes;
  if (!Number.isInteger(state.bufferMinutes) || state.bufferMinutes < 0 || !Number.isInteger(state.revision) || state.revision < 0) throw new Error('缓冲时间或状态版本无效');
  state.currentItinerary = normalizeActivities(state.currentItinerary || [],state.plannedLoungeArrivalAt);
  state.latestEventVersion ||= {}; state.fieldClocks ||= {}; state.processedEvents ||= {};
  state.unavailableServices ||= []; state.closedLounges ||= [];
  return state;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function signature(value) {return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function eventField(event) {
  return {PASSENGER_LATE:'expectedLoungeArrivalAt',FLIGHT_DELAYED:'estimatedDepartureAt',BOARDING_TIME_CHANGED:'boardingAt',GATE_CHANGED:'gate',SERVICE_UNAVAILABLE:'service:'+event.updatedValue,LOUNGE_CLOSED:'lounge:'+event.updatedValue}[event.type];
}
function applyDisruptionEvent(input,event) {
  const state = structuredClone(input), checked = validateEvent(event,state);
  if (!checked.valid) return {status:'rejected',state,errors:checked.errors};
  const fingerprint = signature(event);
  if (Object.hasOwn(state.processedEvents,event.id)) return {status:state.processedEvents[event.id] === fingerprint?'duplicate':'rejected',state,errors:state.processedEvents[event.id] === fingerprint?[]:['事件 ID 已被不同内容使用']};
  const field = eventField(event), clock = state.fieldClocks[field];
  if (clock) {
    const byVersion = event.source === clock.source && event.sourceVersion !== undefined && clock.sourceVersion !== undefined;
    if (byVersion ? event.sourceVersion <= clock.sourceVersion : epoch(event.timestamp) <= epoch(clock.timestamp)) return {status:'stale',state,errors:[]};
  }
  let updated = event.updatedValue;
  if (event.type === 'PASSENGER_LATE') updated = Object.hasOwn(updated,'delayMinutes')?iso(epoch(state.plannedLoungeArrivalAt)+updated.delayMinutes*MINUTE):iso(epoch(updated.expectedArrivalAt));
  // 非空 previousValue 是乐观并发检查；null 表示提供者发出完整快照。
  if (!field.includes(':') && event.previousValue !== null && event.previousValue !== state[field]) return {status:'rejected',state,errors:['previousValue 与当前字段不一致，请刷新事件基线']};
  if (event.type === 'SERVICE_UNAVAILABLE') state.unavailableServices = [...new Set([...state.unavailableServices,updated])];
  else if (event.type === 'LOUNGE_CLOSED') state.closedLounges = [...new Set([...state.closedLounges,updated])];
  else state[field] = updated;
  if (event.type === 'FLIGHT_DELAYED') state.flightStatus = epoch(updated)>epoch(state.scheduledDepartureAt)?'delayed':'scheduled';
  if (event.source !== 'passenger' && (!state.lastFlightUpdateAt || epoch(event.timestamp)>epoch(state.lastFlightUpdateAt))) state.lastFlightUpdateAt = event.timestamp;
  state.fieldClocks[field] = {timestamp:event.timestamp,source:event.source,sourceVersion:event.sourceVersion};
  if (event.sourceVersion !== undefined) state.latestEventVersion[event.source] = Math.max(state.latestEventVersion[event.source] ?? -1,event.sourceVersion);
  state.processedEvents = {...state.processedEvents,[event.id]:fingerprint}; state.revision++;
  return {status:'applied',state,errors:[],stateUpdate:{field,previousValue:input[field] ?? null,updatedValue:updated,revision:state.revision}};
}
module.exports = {createJourneyState,applyDisruptionEvent,signature};
