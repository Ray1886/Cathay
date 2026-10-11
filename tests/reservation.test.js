'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { openDatabase } = require('../backend/db.js');
const { seedDatabase, DEMO_DATE, DEMO_USERS, DEMO_SLOTS } = require('../database/seed.js');
const { createReservationService } = require('../backend/reservation-service.js');

const INITIAL_TIME = '2026-11-01T09:00:00.000Z';
const RACE_WORKER = path.join(__dirname, 'helpers', 'reservation-race-worker.js');

function fixture(t, { seed = true, offerTtlMs = 300000 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cathay-reservation-test-'));
  const filename = path.join(directory, 'reservations.sqlite');
  const db = openDatabase({ filename });
  let now = Date.parse(INITIAL_TIME);
  const service = createReservationService({ db, clock: () => new Date(now), offerTtlMs });
  if (seed) seedDatabase(db, { date: DEMO_DATE });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, service, filename, advance(ms) { now += ms; } };
}

function addEligibleUsers(db, ids = [5, 6, 7]) {
  const insert = db.prepare('INSERT INTO users (id, display_name, membership_tier, created_at) VALUES (?, ?, ?, ?)');
  for (const id of ids) insert.run(id, `Queue passenger ${id}`, id % 2 ? 'first' : 'diamond', INITIAL_TIME);
}

function fullMassageReservation(service) {
  const reservation = service.getUserReservations(DEMO_USERS.a, { status: 'confirmed' })
    .find((row) => row.service_slot_id === DEMO_SLOTS.fullMassage);
  assert.ok(reservation, 'The seeded full massage slot has a confirmed reservation.');
  return reservation;
}

function assertReservationError(action, code, status) {
  assert.throws(action, (error) => {
    assert.equal(error.name, 'ReservationError');
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);
    return true;
  });
}

function availability(service, slotId, expected) {
  const actual = service.getSlotAvailability(slotId);
  for (const [field, value] of Object.entries(expected)) assert.equal(actual[field], value, field);
  assert.equal(actual.capacity, actual.occupied + actual.held + actual.available);
  return actual;
}

function raceRequest(t, request) {
  const child = fork(RACE_WORKER, [JSON.stringify(request)], {
    execPath: process.execPath,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let resolveReady;
  let rejectReady;
  let resolveResult;
  let rejectResult;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // Install a rejection handler before the parent awaits the completion barrier.
  result.catch(() => {});
  let finished = false;
  const timeout = setTimeout(() => {
    const error = new Error(`Reservation race worker timed out. ${stderr}`);
    rejectReady(error);
    rejectResult(error);
    child.kill();
  }, 15000);
  timeout.unref();
  child.on('message', (message) => {
    if (message.type === 'ready') resolveReady();
    if (message.type === 'result') {
      finished = true;
      clearTimeout(timeout);
      if (message.fatal) {
        const error = new Error(`Reservation race worker failed: ${message.message}. ${stderr}`);
        rejectReady(error);
        rejectResult(error);
      } else resolveResult(message);
    }
  });
  child.on('error', (error) => {
    clearTimeout(timeout);
    rejectReady(error);
    rejectResult(error);
  });
  child.on('exit', (code, signal) => {
    if (!finished) {
      clearTimeout(timeout);
      const error = new Error(`Reservation race worker exited (${code ?? signal}). ${stderr}`);
      rejectReady(error);
      rejectResult(error);
    }
  });
  t.after(() => {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return { ready, result, start() { child.send({ type: 'go' }); } };
}

test('demo seed is reproducible and rerunning it preserves existing reservations', (t) => {
  const first = fixture(t, { seed: false });
  const second = fixture(t, { seed: false });
  for (const db of [first.db, second.db]) {
    const seeded = seedDatabase(db, { date: DEMO_DATE });
    assert.equal(seeded.seeded, true);
    assert.equal(seeded.date, DEMO_DATE);
  }
  assert.deepEqual(first.service.listLounges(), second.service.listLounges());
  assert.deepEqual(
    first.service.listAvailableSlots({ date: DEMO_DATE, userId: DEMO_USERS.a, includeFull: true }),
    second.service.listAvailableSlots({ date: DEMO_DATE, userId: DEMO_USERS.a, includeFull: true }),
  );
  const booked = first.service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'survives-seed');
  const rerun = seedDatabase(first.db, { date: DEMO_DATE });
  assert.equal(rerun.seeded, false);
  assert.equal(rerun.date, DEMO_DATE);
  assert.ok(first.service.getUserReservations(DEMO_USERS.a).some((row) => row.reservation_id === booked.reservation_id));
  availability(first.service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
});

test('catalogue contains five lounges and separates walk-in services from slots', (t) => {
  const { service } = fixture(t);
  const lounges = service.listLounges();
  assert.equal(lounges.length, 5);
  const services = lounges.flatMap((lounge) => service.listServices(lounge.lounge_id, { userId: DEMO_USERS.a })
    .map((row) => ({ ...row, catalogueLoungeId: lounge.lounge_id })));
  const codes = new Set(services.map((row) => row.service_code));
  assert.deepEqual([...codes].sort(), ['dining', 'massage', 'rest', 'shower', 'work']);
  assert.equal(codes.has('gate'), false);
  for (const code of ['dining', 'work']) {
    assert.ok(services.some((row) => row.service_code === code && row.reservation_mode === 'walk_in'));
  }
  for (const row of services.filter((service) => service.reservation_mode === 'walk_in')) {
    assert.deepEqual(service.listAvailableSlots({ date: DEMO_DATE, loungeId: row.catalogueLoungeId, serviceCode: row.service_code, userId: DEMO_USERS.a, includeFull: true }), []);
  }
  const slots = service.listAvailableSlots({ date: DEMO_DATE, userId: DEMO_USERS.a, includeFull: true });
  const lastMassage = slots.find((row) => row.slot_id === DEMO_SLOTS.lastMassage);
  assert.equal(lastMassage.start_time, '18:40');
  assert.equal(lastMassage.start_at, '2026-11-01T18:40:00+08:00');
  assert.equal(lastMassage.timezone, 'Asia/Hong_Kong');
  assert.ok(slots.some((row) => row.slot_id === DEMO_SLOTS.optionalRest));
  assert.ok(slots.some((row) => row.slot_id === DEMO_SLOTS.fullMassage));
  const available = service.listAvailableSlots({ date: DEMO_DATE, userId: DEMO_USERS.a });
  assert.equal(available.some((row) => row.slot_id === DEMO_SLOTS.fullMassage), false);
  assert.deepEqual(service.listAvailableSlots({ date: '2026-11-02', userId: DEMO_USERS.a, includeFull: true }), []);
});

test('booking consumes capacity and a repeat idempotency key replays the original row', (t) => {
  const { service } = fixture(t);
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
  const booked = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'one-seat');
  assert.equal(booked.status, 'confirmed');
  assert.equal(booked.replayed, false);
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  const replay = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'one-seat');
  assert.equal(replay.reservation_id, booked.reservation_id);
  assert.equal(replay.replayed, true);
  assert.equal(service.getUserReservations(DEMO_USERS.a, { status: 'confirmed' }).filter((row) => row.service_slot_id === DEMO_SLOTS.lastMassage).length, 1);
  assertReservationError(() => service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'one-seat'), 'IDEMPOTENCY_CONFLICT', 409);
});

test('a cancelled reservation still replays its original idempotency key', (t) => {
  const { service } = fixture(t);
  const booked = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'cancelled-replay');
  const cancelled = service.cancelReservation(booked.reservation_id, DEMO_USERS.a);
  assert.equal(cancelled.status, 'cancelled');
  const replay = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'cancelled-replay');
  assert.equal(replay.reservation_id, booked.reservation_id);
  assert.equal(replay.status, 'cancelled');
  assert.equal(replay.replayed, true);
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
  const replacement = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'fresh-booking');
  assert.notEqual(replacement.reservation_id, booked.reservation_id);
});

test('waitlisting a slot with free capacity is rejected', (t) => {
  const { service } = fixture(t);
  assertReservationError(() => service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.lastMassage), 'SLOT_AVAILABLE', 409);
  assert.deepEqual(service.getUserWaitlist(DEMO_USERS.b), []);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.lastMassage), null);
});

test('membership eligibility is enforced before any booking or waitlist mutation', (t) => {
  const { service } = fixture(t);
  for (const userId of [DEMO_USERS.c, DEMO_USERS.standard]) {
    assertReservationError(() => service.createReservation(userId, DEMO_SLOTS.lastMassage, `ineligible-${userId}`), 'NOT_ELIGIBLE', 403);
    assertReservationError(() => service.joinWaitlist(userId, DEMO_SLOTS.fullMassage), 'NOT_ELIGIBLE', 403);
    assert.equal(service.getUserReservations(userId).length, 0);
    assert.equal(service.getUserWaitlist(userId).length, 0);
  }
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
});

test('invalid IDs, request keys and calendar dates fail without consuming capacity', (t) => {
  const { service } = fixture(t);
  for (const userId of [0, -1, 1.5, '1']) {
    assertReservationError(() => service.createReservation(userId, DEMO_SLOTS.lastMassage, 'invalid-user'), 'INVALID_INPUT', 400);
  }
  for (const slotId of [0, -1, 1001.5, '1001']) {
    assertReservationError(() => service.createReservation(DEMO_USERS.a, slotId, 'invalid-slot'), 'INVALID_INPUT', 400);
  }
  for (const key of ['', ' ', 'line\nbreak', 'x'.repeat(129), null]) {
    assertReservationError(() => service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, key), 'INVALID_INPUT', 400);
  }
  for (const date of ['2026-02-30', '2026-13-01', '2026-11-1', 'tomorrow']) {
    assertReservationError(() => service.listAvailableSlots({ date, userId: DEMO_USERS.a }), 'INVALID_INPUT', 400);
  }
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
});

test('capacity greater than one is enforced and idempotency keys are scoped to each user', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  const first = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'shared-client-key');
  const second = service.createReservation(DEMO_USERS.b, DEMO_SLOTS.shower, 'shared-client-key');
  assert.notEqual(first.reservation_id, second.reservation_id);
  availability(service, DEMO_SLOTS.shower, { capacity: 2, occupied: 2, held: 0, available: 0 });
  assertReservationError(() => service.createReservation(5, DEMO_SLOTS.shower, 'third-shower'), 'SLOT_FULL', 409);
  assertReservationError(() => service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'duplicate-shower'), 'ALREADY_RESERVED', 409);
  service.cancelReservation(first.reservation_id, DEMO_USERS.a);
  availability(service, DEMO_SLOTS.shower, { capacity: 2, occupied: 1, held: 0, available: 1 });
  service.createReservation(5, DEMO_SLOTS.shower, 'third-shower');
  availability(service, DEMO_SLOTS.shower, { capacity: 2, occupied: 2, held: 0, available: 0 });
});

test('one passenger cannot cancel or replace another passenger’s reservation', (t) => {
  const { service } = fixture(t);
  const booked = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'owner-check');
  assertReservationError(() => service.cancelReservation(booked.reservation_id, DEMO_USERS.b), 'FORBIDDEN', 403);
  assertReservationError(() => service.replaceReservation(booked.reservation_id, DEMO_USERS.b, DEMO_SLOTS.shower, 'foreign-replace'), 'FORBIDDEN', 403);
  assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === booked.reservation_id).status, 'confirmed');
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  availability(service, DEMO_SLOTS.shower, { capacity: 2, occupied: 0, held: 0, available: 2 });
});

test('completed and no-show reservations continue to consume their assigned capacity', (t) => {
  const { db, service } = fixture(t);
  for (const [status, slotId] of [['completed', DEMO_SLOTS.lastMassage], ['no_show', DEMO_SLOTS.optionalRest]]) {
    const booked = service.createReservation(DEMO_USERS.a, slotId, `terminal-${status}`);
    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, booked.reservation_id);
    availability(service, slotId, { capacity: 1, occupied: 1, held: 0, available: 0 });
    assertReservationError(() => service.createReservation(DEMO_USERS.b, slotId, `try-${status}`), 'SLOT_FULL', 409);
    const replay = service.createReservation(DEMO_USERS.a, slotId, `terminal-${status}`);
    assert.equal(replay.status, status);
    assert.equal(replay.replayed, true);
    assertReservationError(() => service.cancelReservation(booked.reservation_id, DEMO_USERS.a), 'INVALID_RESERVATION_STATE', 409);
    assertReservationError(() => service.replaceReservation(booked.reservation_id, DEMO_USERS.a, DEMO_SLOTS.shower, `replace-${status}`), 'INVALID_RESERVATION_STATE', 409);
    assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === booked.reservation_id).status, status);
  }
});

test('waitlist order follows entry IDs and cancellation recalculates the remaining positions', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  const first = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const second = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  const third = service.joinWaitlist(6, DEMO_SLOTS.fullMassage);
  assert.ok(first.entry_id < second.entry_id && second.entry_id < third.entry_id);
  assert.equal(first.position, 1);
  assert.equal(second.position, 2);
  assert.equal(third.position, 3);
  assert.equal(service.getWaitlistPosition(6, DEMO_SLOTS.fullMassage).position, 3);
  assert.equal(service.getUserWaitlist(5)[0].entry_id, second.entry_id);
  const cancelled = service.cancelWaitlistEntry(second.entry_id, 5);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.position, null);
  assert.equal(service.getWaitlistPosition(6, DEMO_SLOTS.fullMassage).position, 2);
  const rejoined = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  assert.ok(rejoined.entry_id > third.entry_id);
  assert.equal(rejoined.position, 3);
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage).entry_id, rejoined.entry_id);
});

test('cancelling a reservation offers the first waiter a hold that direct booking cannot steal', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  const first = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  const cancelled = service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  assert.equal(cancelled.status, 'cancelled');
  const offered = service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  assert.equal(offered.entry_id, first.entry_id);
  assert.equal(offered.status, 'offered');
  assert.equal(offered.position, 0);
  assert.equal(offered.offer_expires_at, '2026-11-01T09:05:00.000Z');
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage).position, 1);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
  assertReservationError(() => service.createReservation(6, DEMO_SLOTS.fullMassage, 'cannot-steal-hold'), 'SLOT_FULL', 409);
  assert.deepEqual(service.offerAvailableSlot(DEMO_SLOTS.fullMassage), []);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).offer_expires_at, offered.offer_expires_at);
});

test('accepting a waitlist offer creates one reservation and repeated acceptance replays it', (t) => {
  const { service } = fixture(t);
  const entry = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  const accepted = service.acceptWaitlistOffer(entry.entry_id, DEMO_USERS.b);
  assert.equal(accepted.status, 'confirmed');
  assert.equal(accepted.replayed, false);
  const latest = service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  assert.equal(latest.status, 'accepted');
  assert.equal(latest.position, null);
  assert.equal(latest.reservation_id, accepted.reservation_id);
  const replay = service.acceptWaitlistOffer(entry.entry_id, DEMO_USERS.b);
  assert.equal(replay.reservation_id, accepted.reservation_id);
  assert.equal(replay.replayed, true);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  assert.equal(service.getUserReservations(DEMO_USERS.b).filter((row) => row.service_slot_id === DEMO_SLOTS.fullMassage).length, 1);
  service.cancelReservation(accepted.reservation_id, DEMO_USERS.b);
  const cancelledReplay = service.acceptWaitlistOffer(entry.entry_id, DEMO_USERS.b);
  assert.equal(cancelledReplay.reservation_id, accepted.reservation_id);
  assert.equal(cancelledReplay.status, 'cancelled');
  assert.equal(cancelledReplay.replayed, true);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
});

test('accepting a live offer rechecks the passenger’s current membership', (t) => {
  const { db, service } = fixture(t);
  const entry = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  db.prepare('UPDATE users SET membership_tier = ? WHERE id = ?').run('gold', DEMO_USERS.b);
  assertReservationError(() => service.acceptWaitlistOffer(entry.entry_id, DEMO_USERS.b), 'NOT_ELIGIBLE', 403);
  assert.equal(service.getUserReservations(DEMO_USERS.b).length, 0);
  assert.notEqual(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'accepted');
});

test('an offer expires at its deadline and offer maintenance promotes the next waiter', (t) => {
  const { db, service, advance } = fixture(t, { offerTtlMs: 1000 });
  addEligibleUsers(db);
  const first = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const second = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  advance(999);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'offered');
  advance(1);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
  const expired = service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  assert.equal(expired.entry_id, first.entry_id);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.position, null);
  const promoted = service.offerAvailableSlot(DEMO_SLOTS.fullMassage);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].entry_id, second.entry_id);
  assert.equal(db.prepare('SELECT status FROM waitlist_entries WHERE id = ?').get(first.entry_id).status, 'expired');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
  const offered = service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage);
  assert.equal(offered.entry_id, second.entry_id);
  assert.equal(offered.status, 'offered');
  assert.equal(offered.offer_expires_at, '2026-11-01T09:00:02.000Z');
  assertReservationError(() => service.acceptWaitlistOffer(first.entry_id, DEMO_USERS.b), 'OFFER_EXPIRED', 410);
  service.acceptWaitlistOffer(second.entry_id, 5);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
});

test('availability and waitlist reads report expired holds without writing or promoting the queue', (t) => {
  const { db, service, advance } = fixture(t, { offerTtlMs: 1000 });
  addEligibleUsers(db);
  const first = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const second = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  advance(1000);
  const changesBefore = db.prepare('SELECT total_changes() AS count').get().count;
  const lounges = service.listLounges();
  for (const lounge of lounges) service.listServices(lounge.lounge_id, { userId: DEMO_USERS.a });
  service.listAvailableSlots({ date: DEMO_DATE, userId: DEMO_USERS.a, includeFull: true });
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 0, available: 1 });
  service.getUserReservations(DEMO_USERS.a);
  assert.equal(service.getUserWaitlist(DEMO_USERS.b).find((row) => row.entry_id === first.entry_id).status, 'expired');
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'expired');
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage).status, 'waiting');
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changesBefore);
  assert.equal(db.prepare('SELECT status FROM waitlist_entries WHERE id = ?').get(first.entry_id).status, 'offered');
  assert.equal(db.prepare('SELECT status FROM waitlist_entries WHERE id = ?').get(second.entry_id).status, 'waiting');
});

test('a direct booking after offer expiry preserves the next waiter’s priority even when booking fails', (t) => {
  const { db, service, advance } = fixture(t, { offerTtlMs: 1000 });
  addEligibleUsers(db);
  const first = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const second = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  advance(1000);
  assertReservationError(() => service.createReservation(6, DEMO_SLOTS.fullMassage, 'expiry-cannot-jump-queue'), 'SLOT_FULL', 409);
  assert.equal(db.prepare('SELECT status FROM waitlist_entries WHERE id = ?').get(first.entry_id).status, 'expired');
  assert.equal(db.prepare('SELECT status FROM waitlist_entries WHERE id = ?').get(second.entry_id).status, 'offered');
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage).status, 'offered');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
});

test('an expired waiter can rejoin at the back and the old offer cannot revive', (t) => {
  const { db, service, advance } = fixture(t, { offerTtlMs: 1000 });
  const expired = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  advance(1000);
  assert.deepEqual(service.offerAvailableSlot(DEMO_SLOTS.fullMassage), []);
  const blocking = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.fullMassage, 'after-expiration');
  const rejoined = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  assert.ok(rejoined.entry_id > expired.entry_id);
  assert.equal(rejoined.status, 'waiting');
  assert.equal(rejoined.position, 1);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).entry_id, rejoined.entry_id);
  assertReservationError(() => service.acceptWaitlistOffer(expired.entry_id, DEMO_USERS.b), 'OFFER_EXPIRED', 410);
  assert.equal(db.prepare('SELECT status FROM waitlist_entries WHERE id = ?').get(expired.entry_id).status, 'expired');
  assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === blocking.reservation_id).status, 'confirmed');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
});

test('cancelling an offered waitlist entry immediately passes the hold to the next waiter', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  const first = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const second = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  const cancelled = service.cancelWaitlistEntry(first.entry_id, DEMO_USERS.b);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.position, null);
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage).entry_id, second.entry_id);
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage).status, 'offered');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
});

test('promotion rechecks eligibility and skips a waiter whose membership changed', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const eligible = service.joinWaitlist(5, DEMO_SLOTS.fullMassage);
  db.prepare('UPDATE users SET membership_tier = ? WHERE id = ?').run('gold', DEMO_USERS.b);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  assert.notEqual(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'offered');
  const offered = service.getWaitlistPosition(5, DEMO_SLOTS.fullMassage);
  assert.equal(offered.entry_id, eligible.entry_id);
  assert.equal(offered.status, 'offered');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
});

test('a multi-seat slot holds each newly freed seat for the next waiter', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  const first = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'held-shower-a');
  const second = service.createReservation(DEMO_USERS.b, DEMO_SLOTS.shower, 'held-shower-b');
  service.joinWaitlist(5, DEMO_SLOTS.shower);
  service.joinWaitlist(6, DEMO_SLOTS.shower);
  service.joinWaitlist(7, DEMO_SLOTS.shower);
  service.cancelReservation(first.reservation_id, DEMO_USERS.a);
  availability(service, DEMO_SLOTS.shower, { capacity: 2, occupied: 1, held: 1, available: 0 });
  service.cancelReservation(second.reservation_id, DEMO_USERS.b);
  availability(service, DEMO_SLOTS.shower, { capacity: 2, occupied: 0, held: 2, available: 0 });
  assert.equal(service.getWaitlistPosition(5, DEMO_SLOTS.shower).status, 'offered');
  assert.equal(service.getWaitlistPosition(6, DEMO_SLOTS.shower).status, 'offered');
  assert.equal(service.getWaitlistPosition(7, DEMO_SLOTS.shower).position, 1);
});

test('a passenger with an outstanding offer cannot book or replace into extra target capacity', (t) => {
  const { db, service } = fixture(t);
  addEligibleUsers(db);
  const first = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'offered-shower-a');
  service.createReservation(5, DEMO_SLOTS.shower, 'offered-shower-fixture');
  const waiting = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.shower);
  service.cancelReservation(first.reservation_id, DEMO_USERS.a);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.shower).status, 'offered');
  db.prepare('UPDATE service_slots SET capacity = ? WHERE id = ?').run(3, DEMO_SLOTS.shower);
  availability(service, DEMO_SLOTS.shower, { capacity: 3, occupied: 1, held: 1, available: 1 });
  assertReservationError(() => service.createReservation(DEMO_USERS.b, DEMO_SLOTS.shower, 'offered-direct-book'), 'WAITLIST_OFFER_PENDING', 409);
  assert.equal(service.getUserReservations(DEMO_USERS.b).length, 0);
  const original = service.createReservation(DEMO_USERS.b, DEMO_SLOTS.lastMassage, 'offered-replace-original');
  assertReservationError(() => service.replaceReservation(original.reservation_id, DEMO_USERS.b, DEMO_SLOTS.shower, 'offered-replace-target'), 'WAITLIST_OFFER_PENDING', 409);
  assert.equal(service.getUserReservations(DEMO_USERS.b).find((row) => row.reservation_id === original.reservation_id).status, 'confirmed');
  availability(service, DEMO_SLOTS.shower, { capacity: 3, occupied: 1, held: 1, available: 1 });
  const accepted = service.acceptWaitlistOffer(waiting.entry_id, DEMO_USERS.b);
  assert.equal(accepted.status, 'confirmed');
  assert.equal(accepted.waitlist_entry_id, waiting.entry_id);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.shower).status, 'accepted');
  availability(service, DEMO_SLOTS.shower, { capacity: 3, occupied: 2, held: 0, available: 1 });
});

test('waitlist mutations enforce ownership and waiting entries cannot be accepted', (t) => {
  const { service } = fixture(t);
  const waiting = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  assertReservationError(() => service.cancelWaitlistEntry(waiting.entry_id, DEMO_USERS.a), 'FORBIDDEN', 403);
  assertReservationError(() => service.acceptWaitlistOffer(waiting.entry_id, DEMO_USERS.a), 'FORBIDDEN', 403);
  assertReservationError(() => service.acceptWaitlistOffer(waiting.entry_id, DEMO_USERS.b), 'OFFER_NOT_AVAILABLE', 409);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'waiting');
});

test('replacement failure retains the original booking and a successful retry releases it atomically', (t) => {
  const { service } = fixture(t);
  const original = fullMassageReservation(service);
  const blocking = service.createReservation(DEMO_USERS.b, DEMO_SLOTS.lastMassage, 'replacement-blocker');
  assertReservationError(() => service.replaceReservation(original.reservation_id, DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'replace-attempt'), 'SLOT_FULL', 409);
  assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === original.reservation_id).status, 'confirmed');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  assert.equal(service.getUserReservations(DEMO_USERS.a).filter((row) => row.service_slot_id === DEMO_SLOTS.lastMassage).length, 0);
  service.cancelReservation(blocking.reservation_id, DEMO_USERS.b);
  const waiting = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const replacement = service.replaceReservation(original.reservation_id, DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'replace-attempt');
  assert.equal(replacement.status, 'confirmed');
  assert.equal(replacement.service_slot_id, DEMO_SLOTS.lastMassage);
  assert.equal(replacement.replayed, false);
  assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === original.reservation_id).status, 'cancelled');
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).entry_id, waiting.entry_id);
  assert.equal(service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'offered');
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  const replay = service.replaceReservation(original.reservation_id, DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'replace-attempt');
  assert.equal(replay.reservation_id, replacement.reservation_id);
  assert.equal(replay.replayed, true);
  assertReservationError(() => service.replaceReservation(original.reservation_id, DEMO_USERS.a, DEMO_SLOTS.shower, 'replace-attempt'), 'IDEMPOTENCY_CONFLICT', 409);
});

test('idempotency cannot replay a replacement for a different operation or original reservation', (t) => {
  const { service } = fixture(t);
  const original = fullMassageReservation(service);
  const another = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.optionalRest, 'other-original');
  const replacement = service.replaceReservation(original.reservation_id, DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'bound-replacement');
  assertReservationError(() => service.replaceReservation(another.reservation_id, DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'bound-replacement'), 'IDEMPOTENCY_CONFLICT', 409);
  assertReservationError(() => service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'bound-replacement'), 'IDEMPOTENCY_CONFLICT', 409);
  assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === another.reservation_id).status, 'confirmed');
  assert.equal(service.getUserReservations(DEMO_USERS.a).find((row) => row.reservation_id === replacement.reservation_id).status, 'confirmed');
  service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'bound-create');
  assertReservationError(() => service.replaceReservation(another.reservation_id, DEMO_USERS.a, DEMO_SLOTS.shower, 'bound-create'), 'IDEMPOTENCY_CONFLICT', 409);
});

test('two independent processes competing for the final seat create exactly one reservation', { timeout: 20000 }, async (t) => {
  const { service, filename } = fixture(t);
  const workers = [DEMO_USERS.a, DEMO_USERS.b].map((userId) => raceRequest(t, {
    filename,
    userId,
    slotId: DEMO_SLOTS.lastMassage,
    key: `process-race-${userId}`,
    now: INITIAL_TIME,
  }));
  await Promise.all(workers.map((worker) => worker.ready));
  workers.forEach((worker) => worker.start());
  const results = await Promise.all(workers.map((worker) => worker.result));
  assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
  const loser = results.find((result) => !result.ok);
  assert.equal(loser.code, 'SLOT_FULL');
  assert.equal(loser.status, 409);
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  const reservations = [DEMO_USERS.a, DEMO_USERS.b].flatMap((userId) => service.getUserReservations(userId, { status: 'confirmed' }));
  assert.equal(reservations.filter((row) => row.service_slot_id === DEMO_SLOTS.lastMassage).length, 1);
});

test('a held offer remains protected when acceptance and direct booking race in separate processes', { timeout: 20000 }, async (t) => {
  const { db, service, filename } = fixture(t);
  addEligibleUsers(db);
  const offered = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  service.cancelReservation(fullMassageReservation(service).reservation_id, DEMO_USERS.a);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 0, held: 1, available: 0 });
  const accepting = raceRequest(t, {
    filename,
    action: 'accept',
    userId: DEMO_USERS.b,
    entryId: offered.entry_id,
    now: INITIAL_TIME,
  });
  const booking = raceRequest(t, {
    filename,
    userId: 5,
    slotId: DEMO_SLOTS.fullMassage,
    key: 'cannot-race-held-offer',
    now: INITIAL_TIME,
  });
  await Promise.all([accepting.ready, booking.ready]);
  accepting.start();
  booking.start();
  const [accepted, rejected] = await Promise.all([accepting.result, booking.result]);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.reservation.status, 'confirmed');
  assert.equal(accepted.reservation.user_id, DEMO_USERS.b);
  assert.equal(accepted.reservation.service_slot_id, DEMO_SLOTS.fullMassage);
  assert.equal(accepted.reservation.waitlist_entry_id, offered.entry_id);
  assert.equal(accepted.reservation.replayed, false);
  assert.equal(rejected.ok, false, JSON.stringify(rejected));
  assert.equal(rejected.code, 'SLOT_FULL');
  assert.equal(rejected.status, 409);
  availability(service, DEMO_SLOTS.fullMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
  const latest = service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  assert.equal(latest.entry_id, offered.entry_id);
  assert.equal(latest.status, 'accepted');
  assert.equal(latest.reservation_id, accepted.reservation.reservation_id);
  const reservations = [DEMO_USERS.a, DEMO_USERS.b, 5]
    .flatMap((userId) => service.getUserReservations(userId, { status: 'confirmed' }))
    .filter((row) => row.service_slot_id === DEMO_SLOTS.fullMassage);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].reservation_id, accepted.reservation.reservation_id);
});

test('simultaneous retries from separate processes replay a single committed reservation', { timeout: 20000 }, async (t) => {
  const { service, filename } = fixture(t);
  const workers = [1, 2].map(() => raceRequest(t, {
    filename,
    userId: DEMO_USERS.a,
    slotId: DEMO_SLOTS.lastMassage,
    key: 'shared-race-retry',
    now: INITIAL_TIME,
  }));
  await Promise.all(workers.map((worker) => worker.ready));
  workers.forEach((worker) => worker.start());
  const results = await Promise.all(workers.map((worker) => worker.result));
  assert.equal(results.filter((result) => result.ok).length, 2, JSON.stringify(results));
  assert.equal(results[0].reservation.reservation_id, results[1].reservation.reservation_id);
  assert.deepEqual(results.map((result) => result.reservation.replayed).sort(), [false, true]);
  const reservations = service.getUserReservations(DEMO_USERS.a, { status: 'confirmed' });
  assert.equal(reservations.filter((row) => row.service_slot_id === DEMO_SLOTS.lastMassage).length, 1);
  availability(service, DEMO_SLOTS.lastMassage, { capacity: 1, occupied: 1, held: 0, available: 0 });
});
