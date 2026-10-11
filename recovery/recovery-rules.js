'use strict';
const { SERVICES, resolveServiceLocation } = require('../itinerary.js');
const DEFAULT_RULES = Object.freeze({bufferMinutes:10, transferGapMinutes:5});
function serviceRules(type,locationId) {
  const service = SERVICES[type];
  return service ? {...service,...(type!=='gate'?resolveServiceLocation(type,locationId):{}),reservationRequired:Boolean(service.reservationRequired)} : null;
}
module.exports = {DEFAULT_RULES, serviceRules};
