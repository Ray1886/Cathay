'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../backend/db');
const { seedDatabase, DEMO_USERS, DEMO_SLOTS, DEMO_DATE } = require('../database/seed');
const { createReservationService } = require('../backend/reservation-service');
const { createReservationTools } = require('../backend/reservation-tools');

function fixture(t, options = {}) {
  const db = openDatabase(); seedDatabase(db); t.after(() => db.close());
  let time = new Date('2026-11-01T08:00:00Z');
  const clock = () => new Date(time);
  const service = createReservationService({ db, clock });
  return { db, service, clock, adapter(userId = DEMO_USERS.a) { return createReservationTools({ service, userId, clock, ...options }); }, advance(ms) { time = new Date(time.getTime() + ms); } };
}

test('read/propose tools are user-bound and do not change SQLite', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  const changes = f.db.prepare('SELECT total_changes() AS count').get().count;
  const lounges = adapter.tools.listLounges();
  adapter.tools.listServices({ loungeId: lounges[0].id });
  adapter.tools.listAvailableSlots({ date: DEMO_DATE, includeFull: true });
  adapter.tools.getSlotAvailability({ slotId: DEMO_SLOTS.lastMassage });
  adapter.tools.getUserReservations(); adapter.tools.getUserWaitlist(); adapter.tools.getWaitlistPosition({ slotId: DEMO_SLOTS.lastMassage });
  const proposal = adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage });
  assert.equal(proposal.operation, 'book'); assert.equal(proposal.user_id, DEMO_USERS.a); assert.ok(proposal.proposal_id); assert.ok(proposal.summary.slot);
  assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count, changes);
  assert.equal(adapter.tools.approveProposal, undefined);
  assert.equal(adapter.tools.createReservation, undefined);
  assert.throws(() => adapter.tools.getUserReservations({ userId: DEMO_USERS.b }), { code: 'INVALID_INPUT' });
  assert.throws(() => adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage, userId: DEMO_USERS.b }), { code: 'INVALID_INPUT' });
});

test('only explicit trusted approval commits and approved replay uses one reservation', (t) => {
  const f = fixture(t); const adapter = f.adapter(); const proposal = adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage });
  for (const approval of [undefined, {}, { approved: false }, { approved: 'true' }, { approved: 1 }]) assert.throws(() => adapter.approveProposal(proposal.proposal_id, approval), { code: 'APPROVAL_REQUIRED' });
  assert.equal(f.service.getSlotAvailability(DEMO_SLOTS.lastMassage).occupied, 0);
  const booking = adapter.approveProposal(proposal.proposal_id, { approved: true });
  assert.equal(booking.user_id, DEMO_USERS.a); assert.equal(booking.replayed, false);
  f.advance(600_000);
  const replay = adapter.approveProposal(proposal.proposal_id, { approved: true });
  assert.equal(replay.id, booking.id); assert.equal(replay.replayed, true);
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).filter((row) => row.service_slot_id === DEMO_SLOTS.lastMassage).length, 1);
  assert.throws(() => f.adapter(DEMO_USERS.b).approveProposal(proposal.proposal_id, { approved: true }), { code: 'PROPOSAL_NOT_FOUND' });
});

test('proposal expiry and changed capacity prevent stale approval', (t) => {
  const f = fixture(t, { proposalTtlMs: 1000 }); const a = f.adapter(); const b = f.adapter(DEMO_USERS.b);
  const expiring = a.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage });
  f.advance(1000);
  assert.throws(() => a.approveProposal(expiring.proposal_id, { approved: true }), { code: 'PROPOSAL_EXPIRED' });
  const proposalA = a.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage });
  const proposalB = b.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage });
  a.approveProposal(proposalA.proposal_id, { approved: true });
  assert.throws(() => b.approveProposal(proposalB.proposal_id, { approved: true }), { code: 'PROPOSAL_STALE' });
  assert.throws(() => b.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage }), { code: 'SLOT_FULL' });
  assert.equal(f.service.getSlotAvailability(DEMO_SLOTS.lastMassage).occupied, 1);
});

test('cancel proposals reject another user and stale reservation status', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  const booking = f.service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'tool-cancel-original');
  assert.throws(() => f.adapter(DEMO_USERS.b).tools.proposeCancellation({ reservationId: booking.id }), { code: 'RESERVATION_NOT_FOUND' });
  const proposal = adapter.tools.proposeCancellation({ reservationId: booking.id });
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).find((row) => row.id === booking.id).status, 'confirmed');
  f.service.cancelReservation(booking.id, DEMO_USERS.a);
  assert.throws(() => adapter.approveProposal(proposal.proposal_id, { approved: true }), { code: 'PROPOSAL_STALE' });
});

test('approved cancellation is replayable and automatically promotes the waitlist', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  const booking = f.service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'tool-cancel-queue');
  f.service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.lastMassage);
  const proposal = adapter.tools.proposeCancellation({ reservationId: booking.id });
  const cancelled = adapter.approveProposal(proposal.proposal_id, { approved: true });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(adapter.approveProposal(proposal.proposal_id, { approved: true }).replayed, true);
  assert.equal(f.service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.lastMassage).status, 'offered');
});

test('modification is proposed without writes and approved with atomic replacement', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  const booking = f.service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'tool-modify-original');
  const before = f.db.prepare('SELECT total_changes() AS count').get().count;
  const proposal = adapter.tools.proposeModification({ reservationId: booking.id, newSlotId: DEMO_SLOTS.shower });
  assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count, before);
  assert.throws(() => adapter.approveProposal(proposal.proposal_id, { approved: false }), { code: 'APPROVAL_REQUIRED' });
  const replacement = adapter.approveProposal(proposal.proposal_id, { approved: true });
  assert.equal(replacement.service_slot_id, DEMO_SLOTS.shower); assert.equal(replacement.status, 'confirmed');
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).find((row) => row.id === booking.id).status, 'cancelled');
  assert.equal(f.service.getSlotAvailability(DEMO_SLOTS.lastMassage).occupied, 0);
  assert.equal(adapter.approveProposal(proposal.proposal_id, { approved: true }).id, replacement.id);
});

test('eligibility and a competing replacement target are checked before commit', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  assert.throws(() => f.adapter(DEMO_USERS.standard).tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage }), { code: 'PROPOSAL_NOT_BOOKABLE' });
  const booking = f.service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'tool-current-original');
  const proposal = adapter.tools.proposeModification({ reservationId: booking.id, newSlotId: DEMO_SLOTS.shower });
  f.db.prepare('UPDATE service_slots SET active = 0 WHERE id = ?').run(DEMO_SLOTS.shower);
  assert.throws(() => adapter.approveProposal(proposal.proposal_id, { approved: true }), { code: 'PROPOSAL_STALE' });
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).find((row) => row.id === booking.id).status, 'confirmed');
});

test('duplicate proposals reject an existing non-cancelled booking despite spare capacity', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  const booking = f.service.createReservation(DEMO_USERS.a, DEMO_SLOTS.shower, 'tool-spare-capacity');
  assert.equal(f.service.getSlotAvailability(DEMO_SLOTS.shower).available, 1);
  const before = f.db.prepare('SELECT total_changes() AS count').get().count;
  assert.throws(() => adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.shower }), { code: 'ALREADY_RESERVED' });
  assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count, before);
  f.service.cancelReservation(booking.id, DEMO_USERS.a);
  assert.equal(adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.shower }).operation, 'book');
});

test('own held waitlist offer blocks direct booking and modification proposals without writes', (t) => {
  const f = fixture(t); const adapter = f.adapter(DEMO_USERS.b);
  const source = f.service.createReservation(DEMO_USERS.b, DEMO_SLOTS.shower, 'tool-offer-source');
  f.service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.fullMassage);
  const seeded = f.service.getUserReservations(DEMO_USERS.a, {}).find((row) => row.service_slot_id === DEMO_SLOTS.fullMassage);
  f.service.cancelReservation(seeded.id, DEMO_USERS.a);
  assert.equal(f.service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.fullMassage).status, 'offered');
  const before = f.db.prepare('SELECT total_changes() AS count').get().count;
  assert.throws(() => adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.fullMassage }), { code: 'WAITLIST_OFFER_PENDING' });
  assert.throws(() => adapter.tools.proposeModification({ reservationId: source.id, newSlotId: DEMO_SLOTS.fullMassage }), { code: 'WAITLIST_OFFER_PENDING' });
  assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count, before);
  assert.equal(f.service.getUserReservations(DEMO_USERS.b, {}).find((row) => row.id === source.id).status, 'confirmed');
});

test('replaying a prior booking approval returns persisted cancellation without resurrection', (t) => {
  const f = fixture(t); const adapter = f.adapter();
  const bookingProposal = adapter.tools.proposeBooking({ slotId: DEMO_SLOTS.lastMassage });
  const booking = adapter.approveProposal(bookingProposal.proposal_id, { approved: true });
  const cancellationProposal = adapter.tools.proposeCancellation({ reservationId: booking.id });
  const cancelled = adapter.approveProposal(cancellationProposal.proposal_id, { approved: true });
  assert.equal(cancelled.status, 'cancelled');
  const before = f.db.prepare('SELECT total_changes() AS count').get().count;
  const replay = adapter.approveProposal(bookingProposal.proposal_id, { approved: true });
  assert.equal(replay.id, booking.id); assert.equal(replay.status, 'cancelled'); assert.equal(replay.cancelled_at, cancelled.cancelled_at); assert.equal(replay.replayed, true);
  assert.equal(f.db.prepare('SELECT total_changes() AS count').get().count, before);
  assert.equal(f.service.getSlotAvailability(DEMO_SLOTS.lastMassage).occupied, 0);
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).filter((row) => row.service_slot_id === DEMO_SLOTS.lastMassage).length, 1);
});
