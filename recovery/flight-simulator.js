'use strict';
const {epoch,iso,MINUTE} = require('./time');
class MockFlightProvider {
  constructor({flightNumber='CX251',providerId='demo',startVersion=0}={}) {this.flightNumber=flightNumber;this.providerId=providerId;this.version=startVersion;this.listeners=new Set();}
  subscribe(listener) {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  emit(type,previousValue,updatedValue,timestamp,payload={}) {
    epoch(timestamp);
    const sourceVersion=++this.version;
    const event={id:this.providerId+':'+sourceVersion,type,source:'mock_flight_provider',timestamp,flightNumber:this.flightNumber,sourceVersion,previousValue,updatedValue,payload};
    for(const listener of this.listeners) listener(structuredClone(event));
    return event;
  }
  delayDeparture(state,minutes,timestamp) {
    if(!Number.isInteger(minutes)||minutes<0) throw new Error('延误分钟无效');
    return this.emit('FLIGHT_DELAYED',state.estimatedDepartureAt,iso(epoch(state.scheduledDepartureAt)+minutes*MINUTE),timestamp,{baseline:'scheduledDepartureAt'});
  }
  changeBoarding(state,boardingAt,timestamp) {epoch(boardingAt);return this.emit('BOARDING_TIME_CHANGED',state.boardingAt,boardingAt,timestamp);}
  changeGate(state,gate,timestamp) {return this.emit('GATE_CHANGED',state.gate,gate,timestamp);}
  restore(state,snapshot,timestamp) {
    return [this.emit('FLIGHT_DELAYED',state.estimatedDepartureAt,snapshot.estimatedDepartureAt,timestamp,{restore:true}),this.emit('BOARDING_TIME_CHANGED',state.boardingAt,snapshot.boardingAt,timestamp,{restore:true}),this.emit('GATE_CHANGED',state.gate,snapshot.gate,timestamp,{restore:true})];
  }
}
module.exports = {MockFlightProvider};
