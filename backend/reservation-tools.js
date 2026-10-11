'use strict';

const { randomUUID } = require('node:crypto');
const { ReservationError } = require('./reservation-rules');

function toolError(code, status, message) { return new ReservationError(code, message, status); }
function id(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw toolError('INVALID_INPUT', 400, `${name} must be a positive integer.`);
  return value;
}
function args(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw toolError('INVALID_INPUT', 400, 'Tool arguments must be an object.');
  for (const key of Object.keys(input)) if (!fields.includes(key)) throw toolError('INVALID_INPUT', 400, `Unknown tool argument: ${key}.`);
  return input;
}
function rowId(row) { return row.reservation_id ?? row.id; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function fingerprint(value) { return JSON.stringify(canonical(value)); }

// Only `tools` belongs in an LLM tool registry. `approveProposal` is a trusted UI
// callback; registering it as a model tool would defeat the approval boundary.
function createReservationTools({ service, userId, clock = () => new Date(), proposalTtlMs = 5 * 60 * 1000 }) {
  if (!service) throw new TypeError('service is required.');
  id(userId, 'userId');
  if (!Number.isSafeInteger(proposalTtlMs) || proposalTtlMs <= 0) throw new TypeError('proposalTtlMs must be a positive integer.');
  const proposals = new Map();
  const now = () => {
    const value = clock();
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) throw new TypeError('clock must return a valid date.');
    return time;
  };
  function ownReservation(reservationId) {
    const row = service.getUserReservations(userId, {}).find((item) => rowId(item) === reservationId);
    if (!row) throw toolError('RESERVATION_NOT_FOUND', 404, 'The reservation does not belong to this demo user.');
    return row;
  }
  function currentState(operation, input) {
    if (operation === 'cancel') return { reservation: ownReservation(input.reservationId) };
    const slotId = operation === 'book' ? input.slotId : input.newSlotId;
    const state = { slot: service.getSlotAvailability(slotId), reservations: service.getUserReservations(userId, {}), waitlist: service.getWaitlistPosition(userId, slotId) };
    if (operation === 'modify') state.reservation = ownReservation(input.reservationId);
    return state;
  }
  function propose(operation, input) {
    const state = currentState(operation, input);
    if (state.reservation && state.reservation.status !== 'confirmed') throw toolError('RESERVATION_NOT_ACTIVE', 409, 'Only a confirmed reservation can be changed.');
    if (operation === 'modify' && (state.reservation.service_slot_id ?? state.reservation.slot_id) === input.newSlotId) throw toolError('INVALID_INPUT', 400, 'The new slot must differ from the current reservation slot.');
    if (state.slot) {
      const slotId = operation === 'book' ? input.slotId : input.newSlotId;
      if (state.reservations.some((row) => (row.service_slot_id ?? row.slot_id) === slotId && row.status !== 'cancelled')) throw toolError('ALREADY_RESERVED', 409, 'This demo user already has a non-cancelled reservation for this slot.');
      if (state.waitlist?.status === 'offered') throw toolError('WAITLIST_OFFER_PENDING', 409, 'Accept or decline the existing waitlist offer before proposing a direct booking for this slot.');
    }
    if (state.slot && Number(state.slot.available) <= 0) throw toolError('SLOT_FULL', 409, 'This slot currently has no available capacity.');
    if (state.slot) {
      const slotId = operation === 'book' ? input.slotId : input.newSlotId;
      const eligible = service.listAvailableSlots({ date: state.slot.service_date, userId, includeFull: true }).some((slot) => (slot.service_slot_id ?? slot.slot_id ?? slot.id) === slotId);
      if (!eligible) throw toolError('PROPOSAL_NOT_BOOKABLE', 409, 'This slot is not available to this demo user.');
      if (state.slot.direct_bookable === false || state.slot.direct_bookable === 0) throw toolError('WAITLIST_PRIORITY', 409, 'An existing waitlist must be served before direct booking.');
    }
    const proposalId = randomUUID();
    const expiresAt = now() + proposalTtlMs;
    const summary = operation === 'book' ? { slot: state.slot } : operation === 'cancel' ? { reservation: state.reservation } : { reservation: state.reservation, new_slot: state.slot };
    const view = { proposal_id: proposalId, operation, user_id: userId, expires_at: new Date(expiresAt).toISOString(), summary };
    proposals.set(proposalId, { operation, input: { ...input }, state: fingerprint(state), expiresAt, view, result: undefined });
    return structuredClone(view);
  }
  const tools = Object.freeze({
    listLounges(input = {}) { args(input, []); return service.listLounges(); },
    listServices(input) { args(input, ['loungeId']); return service.listServices(id(input.loungeId, 'loungeId'), { userId }); },
    listAvailableSlots(input) {
      args(input, ['date', 'loungeId', 'serviceCode', 'includeFull']);
      if (input.loungeId !== undefined) id(input.loungeId, 'loungeId');
      if (input.includeFull !== undefined && typeof input.includeFull !== 'boolean') throw toolError('INVALID_INPUT', 400, 'includeFull must be a boolean.');
      return service.listAvailableSlots({ ...input, userId });
    },
    getSlotAvailability(input) { args(input, ['slotId']); return service.getSlotAvailability(id(input.slotId, 'slotId')); },
    getUserReservations(input = {}) { args(input, ['status']); return service.getUserReservations(userId, input); },
    getUserWaitlist(input = {}) { args(input, []); return service.getUserWaitlist(userId); },
    getWaitlistPosition(input) { args(input, ['slotId']); return service.getWaitlistPosition(userId, id(input.slotId, 'slotId')); },
    proposeBooking(input) { args(input, ['slotId']); id(input.slotId, 'slotId'); return propose('book', input); },
    proposeCancellation(input) { args(input, ['reservationId']); id(input.reservationId, 'reservationId'); return propose('cancel', input); },
    proposeModification(input) { args(input, ['reservationId', 'newSlotId']); id(input.reservationId, 'reservationId'); id(input.newSlotId, 'newSlotId'); return propose('modify', input); }
  });

  function approveProposal(proposalId, approval) {
    if (!approval || approval.approved !== true) throw toolError('APPROVAL_REQUIRED', 403, 'An explicit approval from the trusted UI is required.');
    args(approval, ['approved']);
    if (typeof proposalId !== 'string' || !proposals.has(proposalId)) throw toolError('PROPOSAL_NOT_FOUND', 404, 'The proposal is not known to this user-bound adapter.');
    const proposal = proposals.get(proposalId);
    if (proposal.result !== undefined) return { ...structuredClone(ownReservation(rowId(proposal.result))), replayed: true };
    if (now() >= proposal.expiresAt) throw toolError('PROPOSAL_EXPIRED', 410, 'This proposal has expired. Request a new proposal.');
    let state;
    try { state = currentState(proposal.operation, proposal.input); }
    catch (error) {
      if (error.status === 404) throw toolError('PROPOSAL_STALE', 409, 'The reservation or slot changed. Request a new proposal.');
      throw error;
    }
    if (fingerprint(state) !== proposal.state) throw toolError('PROPOSAL_STALE', 409, 'The current reservation or slot differs from the reviewed proposal. Request a new proposal.');
    const key = `proposal:${proposalId}`;
    let result;
    if (proposal.operation === 'book') result = service.createReservation(userId, proposal.input.slotId, key);
    else if (proposal.operation === 'cancel') result = service.cancelReservation(proposal.input.reservationId, userId);
    else result = service.replaceReservation(proposal.input.reservationId, userId, proposal.input.newSlotId, key);
    proposal.result = structuredClone({ ...result, replayed: Boolean(result.replayed) });
    return structuredClone(proposal.result);
  }
  return Object.freeze({ tools, approveProposal });
}

module.exports = { createReservationTools };
