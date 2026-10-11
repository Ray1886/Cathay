'use strict';

class ReservationError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'ReservationError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

const MEMBERSHIP_TIERS = Object.freeze(['first', 'business', 'diamond', 'gold', 'standard']);
const SERVICE_CODES = Object.freeze(['shower', 'dining', 'massage', 'rest', 'work']);
const RESERVATION_STATUSES = Object.freeze(['confirmed', 'cancelled', 'completed', 'no_show']);
const WAITLIST_STATUSES = Object.freeze(['waiting', 'offered', 'accepted', 'expired', 'cancelled']);

function positiveId(value, label = 'id') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReservationError('INVALID_INPUT', `${label} must be a positive safe integer.`);
  }
  return value;
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new ReservationError('INVALID_INPUT', 'idempotencyKey must contain 1–128 ASCII letters, digits, dots, underscores, colons or hyphens.');
  }
  return value;
}

function serviceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2099-12-31') {
    throw new ReservationError('INVALID_INPUT', 'date must be a valid YYYY-MM-DD between 2000 and 2099.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ReservationError('INVALID_INPUT', 'date is not a valid calendar date.');
  }
  return value;
}

function utcTimestamp(clock) {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('clock must return a valid Date.');
  }
  return now.toISOString();
}

function eligible(tier, tiers) { return tiers.includes(tier); }

function requireReservable(slot) {
  if (!slot.active || !slot.lounge_active || !slot.lounge_service_active) {
    throw new ReservationError('SLOT_INACTIVE', 'This slot or its lounge service is inactive.', 409);
  }
  if (slot.reservation_mode === 'walk_in') {
    throw new ReservationError('WALK_IN_ONLY', 'Walk-in activities belong in the itinerary and do not create reservations.', 409);
  }
}

module.exports = { ReservationError, MEMBERSHIP_TIERS, SERVICE_CODES, RESERVATION_STATUSES,
  WAITLIST_STATUSES, positiveId, idempotencyKey, serviceDate, utcTimestamp, eligible, requireReservable };
