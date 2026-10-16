'use strict';

const { withTransaction } = require('./db');
const { ReservationError, RESERVATION_STATUSES, SERVICE_CODES, positiveId, idempotencyKey,
  serviceDate, utcTimestamp, eligible, requireReservable } = require('./reservation-rules');

function createReservationService({ db, clock = () => new Date(), offerTtlMs = 300000 } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('An initialized SQLite database is required.');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function returning a Date.');
  if (!Number.isSafeInteger(offerTtlMs) || offerTtlMs < 1 || offerTtlMs > 3600000) throw new TypeError('offerTtlMs must be from 1 to 3600000 milliseconds.');

  const slotQuery = `SELECT ss.*, ls.lounge_id, ls.reservation_mode, ls.eligible_tiers, ls.preparation_minutes,
    ls.active AS lounge_service_active, l.active AS lounge_active, l.name AS lounge_name,
    s.code AS service_code, s.display_name, s.default_duration_minutes
    FROM service_slots ss JOIN lounge_services ls ON ls.id = ss.lounge_service_id
    JOIN lounges l ON l.id = ls.lounge_id JOIN services s ON s.id = ls.service_id`;

  function database(operation) {
    try { return operation(); }
    catch (error) {
      if (error instanceof ReservationError) throw error;
      if (error.errcode === 5 || error.errcode === 6 || /database is (locked|busy)/i.test(error.message)) {
        throw new ReservationError('DATABASE_BUSY', 'Database is busy; retry the whole operation with the same idempotency key.', 503);
      }
      throw error;
    }
  }
  let transactionId=0;
  function transaction(operation) {
    if(!db.isTransaction)return withTransaction(db,operation);
    // An explicit demo reset may compose synchronous service calls atomically.
    const name='reservation_service_'+(++transactionId);
    db.exec('SAVEPOINT '+name);
    try {const result=operation();db.exec('RELEASE '+name);return result;}
    catch(error){db.exec('ROLLBACK TO '+name+'; RELEASE '+name);throw error;}
  }
  function user(id) {
    positiveId(id, 'userId');
    const found = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!found) throw new ReservationError('USER_NOT_FOUND', 'Demo user not found.', 404);
    return found;
  }
  function slot(id) {
    positiveId(id, 'slotId');
    const found = db.prepare(`${slotQuery} WHERE ss.id = ?`).get(id);
    if (!found) throw new ReservationError('SLOT_NOT_FOUND', 'Service slot not found.', 404);
    return { ...found, eligible_tiers: JSON.parse(found.eligible_tiers) };
  }
  function reservation(id) {
    positiveId(id, 'reservationId');
    const found = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
    if (!found) throw new ReservationError('RESERVATION_NOT_FOUND', 'Reservation not found.', 404);
    return found;
  }
  function entry(id) {
    positiveId(id, 'entryId');
    const found = db.prepare('SELECT * FROM waitlist_entries WHERE id = ?').get(id);
    if (!found) throw new ReservationError('WAITLIST_NOT_FOUND', 'Waitlist entry not found.', 404);
    return found;
  }
  function own(row, userId) {
    user(userId);
    if (row.user_id !== userId) throw new ReservationError('FORBIDDEN', 'This record belongs to another demo user.', 403);
  }
  function allowed(userId, selectedSlot) {
    const person = user(userId);
    requireReservable(selectedSlot);
    if (!eligible(person.membership_tier, selectedSlot.eligible_tiers)) {
      throw new ReservationError('NOT_ELIGIBLE', 'This demo membership tier is not eligible for the selected service.', 403);
    }
  }
  function emit(eventType, userId, reservationId, payload, now) {
    db.prepare('INSERT INTO reservation_events(reservation_id,user_id,event_type,event_payload,created_at) VALUES (?,?,?,?,?)')
      .run(reservationId ?? null, userId ?? null, eventType, JSON.stringify(payload), now);
  }
  function resSnapshot(row, replayed = false) { return { ...row, reservation_id: row.id, replayed }; }
  function waitSnapshot(row, now) {
    const expired = row.status === 'offered' && row.offer_expires_at <= now;
    const status = expired ? 'expired' : row.status;
    let position = null;
    if (status === 'offered') position = 0;
    else if (status === 'waiting') {
      position = db.prepare("SELECT count(*) AS n FROM waitlist_entries WHERE service_slot_id = ? AND status = 'waiting' AND id <= ?")
        .get(row.service_slot_id, row.id).n;
    }
    return { ...row, entry_id: row.id, status, persisted_status: row.status, position };
  }
  function availability(selectedSlot, now) {
    const occupied = db.prepare("SELECT count(*) AS n FROM reservations WHERE service_slot_id = ? AND status <> 'cancelled'")
      .get(selectedSlot.id).n;
    const held = db.prepare("SELECT count(*) AS n FROM waitlist_entries WHERE service_slot_id = ? AND status = 'offered' AND offer_expires_at > ?")
      .get(selectedSlot.id, now).n;
    const waitingCount = db.prepare(`SELECT count(*) AS n FROM waitlist_entries w JOIN users u ON u.id = w.user_id
      WHERE w.service_slot_id = ? AND w.status = 'waiting' AND u.membership_tier IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.user_id = w.user_id AND r.service_slot_id = w.service_slot_id AND r.status <> 'cancelled')`)
      .get(selectedSlot.id, JSON.stringify(selectedSlot.eligible_tiers)).n;
    const active = Boolean(selectedSlot.active && selectedSlot.lounge_active && selectedSlot.lounge_service_active);
    const available = active && selectedSlot.reservation_mode !== 'walk_in' ? Math.max(0, selectedSlot.capacity - occupied - held) : 0;
    return { id: selectedSlot.id, slot_id: selectedSlot.id, service_slot_id: selectedSlot.id,
      lounge_service_id: selectedSlot.lounge_service_id, lounge_id: selectedSlot.lounge_id,
      lounge_name: selectedSlot.lounge_name, service_code: selectedSlot.service_code, display_name: selectedSlot.display_name,
      service_date: selectedSlot.service_date, start_time: selectedSlot.start_time, end_time: selectedSlot.end_time,
      start_at: `${selectedSlot.service_date}T${selectedSlot.start_time}:00+08:00`,
      end_at: `${selectedSlot.service_date}T${selectedSlot.end_time}:00+08:00`, timezone: 'Asia/Hong_Kong',
      reservation_mode: selectedSlot.reservation_mode, preparation_minutes: selectedSlot.preparation_minutes,
      capacity: selectedSlot.capacity, occupied, held, available, waiting_count: waitingCount,
      direct_bookable: available > 0 && waitingCount === 0, active };
  }
  function activeReservation(userId, slotId) {
    return db.prepare("SELECT id FROM reservations WHERE user_id = ? AND service_slot_id = ? AND status <> 'cancelled'").get(userId, slotId);
  }
  function duplicate(userId, slotId) {
    if (activeReservation(userId, slotId)) throw new ReservationError('ALREADY_RESERVED', 'User already has a non-cancelled reservation for this slot.', 409);
  }
  function noOutstandingOffer(userId, slotId) {
    if (db.prepare("SELECT id FROM waitlist_entries WHERE user_id = ? AND service_slot_id = ? AND status = 'offered'").get(userId, slotId)) {
      throw new ReservationError('WAITLIST_OFFER_PENDING', 'Accept or decline your outstanding waitlist offer instead of making a separate booking.', 409);
    }
  }
  function replay(userId, slotId, key, operation, replacesId = null) {
    const previous = db.prepare('SELECT * FROM reservations WHERE user_id = ? AND idempotency_key = ?').get(userId, key);
    if (!previous) return null;
    if (previous.service_slot_id !== slotId || previous.operation !== operation || previous.replaces_reservation_id !== replacesId) {
      throw new ReservationError('IDEMPOTENCY_CONFLICT', 'This user has already used the key for a different operation, slot or source reservation.', 409);
    }
    return resSnapshot(previous, true);
  }
  function insertReservation(userId, slotId, key, now, operation = 'create', waitlistId = null, replacesId = null) {
    const result = db.prepare(`INSERT INTO reservations(user_id,service_slot_id,status,created_at,updated_at,idempotency_key,operation,waitlist_entry_id,replaces_reservation_id)
      VALUES (?,?,'confirmed',?,?,?,?,?,?)`).run(userId, slotId, now, now, key, operation, waitlistId, replacesId);
    const created = reservation(Number(result.lastInsertRowid));
    emit('reservation_created', userId, created.id, { slot_id: slotId, operation, waitlist_entry_id: waitlistId, replaces_reservation_id: replacesId }, now);
    return resSnapshot(created);
  }
  function maintain(selectedSlot, now) {
    const expired = db.prepare("SELECT * FROM waitlist_entries WHERE service_slot_id = ? AND status = 'offered' AND offer_expires_at <= ? ORDER BY id").all(selectedSlot.id, now);
    for (const row of expired) {
      db.prepare("UPDATE waitlist_entries SET status = 'expired' WHERE id = ?").run(row.id);
      emit('waitlist_offer_expired', row.user_id, null, { entry_id: row.id, slot_id: row.service_slot_id }, now);
    }
    if (!selectedSlot.active || !selectedSlot.lounge_active || !selectedSlot.lounge_service_active || selectedSlot.reservation_mode === 'walk_in') return [];
    const offered = [];
    const queue = db.prepare("SELECT w.*, u.membership_tier FROM waitlist_entries w JOIN users u ON u.id = w.user_id WHERE w.service_slot_id = ? AND w.status = 'waiting' ORDER BY w.id ASC")
      .all(selectedSlot.id);
    for (const candidate of queue) {
      if (!eligible(candidate.membership_tier, selectedSlot.eligible_tiers) || activeReservation(candidate.user_id, selectedSlot.id)) {
        db.prepare("UPDATE waitlist_entries SET status = 'cancelled' WHERE id = ?").run(candidate.id);
        emit('waitlist_cancelled', candidate.user_id, null, { entry_id: candidate.id, slot_id: selectedSlot.id, reason: 'no_longer_eligible_or_already_reserved' }, now);
        continue;
      }
      if (availability(selectedSlot, now).available <= 0) break;
      const expires = new Date(Date.parse(now) + offerTtlMs).toISOString();
      db.prepare("UPDATE waitlist_entries SET status = 'offered', offer_expires_at = ? WHERE id = ?").run(expires, candidate.id);
      emit('waitlist_offer_created', candidate.user_id, null, { entry_id: candidate.id, slot_id: selectedSlot.id, offer_expires_at: expires }, now);
      offered.push(waitSnapshot(entry(candidate.id), now));
    }
    return offered;
  }

  function mutation(slotIds, operation) {
    const now = utcTimestamp(clock);
    const result = database(() => transaction(() => {
      for (const id of [...new Set(slotIds)]) maintain(slot(id), now);
      // Housekeeping must survive a rejected booking, but a failed replacement must
      // roll back all of its own changes. No async work runs within either boundary.
      db.exec('SAVEPOINT booking_operation');
      try {
        const value = operation(now);
        db.exec('RELEASE booking_operation');
        return { value };
      } catch (error) {
        if (!(error instanceof ReservationError)) throw error;
        db.exec('ROLLBACK TO booking_operation; RELEASE booking_operation;');
        return { error };
      }
    }));
    if (result.error) throw result.error;
    return result.value;
  }

  function listLounges() {
    return database(() => db.prepare('SELECT * FROM lounges WHERE active = 1 ORDER BY id').all().map(row => ({ ...row, lounge_id: row.id })));
  }
  function listServices(loungeId, options = {}) {
    positiveId(loungeId, 'loungeId');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ReservationError('INVALID_INPUT', 'Service options must be an object.');
    const person = options.userId === undefined ? null : user(options.userId);
    if (!db.prepare('SELECT id FROM lounges WHERE id = ?').get(loungeId)) throw new ReservationError('LOUNGE_NOT_FOUND', 'Lounge not found.', 404);
    return database(() => db.prepare(`SELECT ls.*, s.code, s.display_name, s.default_duration_minutes, s.category
      FROM lounge_services ls JOIN lounges l ON l.id = ls.lounge_id JOIN services s ON s.id = ls.service_id
      WHERE ls.lounge_id = ? AND ls.active = 1 AND l.active = 1 ORDER BY s.id`).all(loungeId).map(row => {
      const tiers = JSON.parse(row.eligible_tiers);
      return { ...row, lounge_service_id: row.id, service_code: row.code, eligible_tiers: tiers,
        eligible: person ? eligible(person.membership_tier, tiers) : null };
    }));
  }
  function getSlotAvailability(slotId) { return database(() => availability(slot(slotId), utcTimestamp(clock))); }
  function listAvailableSlots(filters = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new ReservationError('INVALID_INPUT', 'Slot filters must be an object.');
    const clauses = [], values = [];
    if (filters.date !== undefined) { clauses.push('ss.service_date = ?'); values.push(serviceDate(filters.date)); }
    if (filters.loungeId !== undefined) { clauses.push('ls.lounge_id = ?'); values.push(positiveId(filters.loungeId, 'loungeId')); }
    if (filters.serviceCode !== undefined) {
      if (!SERVICE_CODES.includes(filters.serviceCode)) throw new ReservationError('INVALID_INPUT', 'serviceCode must be shower, dining, massage, rest or work.');
      clauses.push('s.code = ?'); values.push(filters.serviceCode);
    }
    if (filters.includeFull !== undefined && typeof filters.includeFull !== 'boolean') throw new ReservationError('INVALID_INPUT', 'includeFull must be a boolean.');
    const person = filters.userId === undefined ? null : user(filters.userId);
    const now = utcTimestamp(clock);
    return database(() => db.prepare(`${slotQuery}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ss.service_date, ss.start_time, ss.id`).all(...values)
      .map(row => ({ ...row, eligible_tiers: JSON.parse(row.eligible_tiers) }))
      .filter(row => (!person || eligible(person.membership_tier, row.eligible_tiers)))
      .map(row => ({ ...availability(row, now), eligible: person ? true : null }))
      .filter(row => row.active && (filters.includeFull || row.direct_bookable)));
  }
  function createReservation(userId, slotId, key) {
    positiveId(userId, 'userId'); positiveId(slotId, 'slotId'); idempotencyKey(key);
    return mutation([slotId], now => {
      user(userId);
      const previous = replay(userId, slotId, key, 'create');
      if (previous) return previous;
      const selectedSlot = slot(slotId);
      allowed(userId, selectedSlot); duplicate(userId, slotId);
      noOutstandingOffer(userId, slotId);
      if (availability(selectedSlot, now).available <= 0) throw new ReservationError('SLOT_FULL', 'Slot has no unheld capacity. A waitlist offer is not a confirmed reservation.', 409);
      return insertReservation(userId, slotId, key, now);
    });
  }
  function getUserReservations(userId, options = {}) {
    user(userId);
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ReservationError('INVALID_INPUT', 'Reservation options must be an object.');
    if (options.status !== undefined && !RESERVATION_STATUSES.includes(options.status)) throw new ReservationError('INVALID_INPUT', 'Invalid reservation status filter.');
    return database(() => db.prepare(`SELECT * FROM reservations WHERE user_id = ?${options.status === undefined ? '' : ' AND status = ?'} ORDER BY id`)
      .all(...(options.status === undefined ? [userId] : [userId, options.status])).map(row => resSnapshot(row)));
  }
  function cancelReservation(reservationId, userId) {
    positiveId(userId, 'userId');
    const initial = reservation(reservationId);
    return mutation([initial.service_slot_id], now => {
      const current = reservation(reservationId); own(current, userId);
      if (current.status === 'cancelled') return resSnapshot(current, true);
      if (current.status !== 'confirmed') throw new ReservationError('INVALID_RESERVATION_STATE', 'Only confirmed reservations can be cancelled.', 409);
      db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = ?, cancelled_at = ? WHERE id = ?").run(now, now, reservationId);
      emit('reservation_cancelled', userId, reservationId, { slot_id: current.service_slot_id }, now);
      maintain(slot(current.service_slot_id), now);
      return resSnapshot(reservation(reservationId));
    });
  }
  function joinWaitlist(userId, slotId) {
    positiveId(userId, 'userId'); positiveId(slotId, 'slotId');
    return mutation([slotId], now => {
      const selectedSlot = slot(slotId); allowed(userId, selectedSlot); duplicate(userId, slotId);
      const previous = db.prepare("SELECT * FROM waitlist_entries WHERE user_id = ? AND service_slot_id = ? AND status IN ('waiting','offered')").get(userId, slotId);
      if (previous) return { ...waitSnapshot(previous, now), replayed: true };
      if (availability(selectedSlot, now).available > 0) throw new ReservationError('SLOT_AVAILABLE', 'This slot is available; request a reservation instead of waitlisting.', 409);
      const created = db.prepare("INSERT INTO waitlist_entries(user_id,service_slot_id,status,created_at) VALUES (?,?,'waiting',?)").run(userId, slotId, now);
      const id = Number(created.lastInsertRowid);
      emit('waitlist_joined', userId, null, { entry_id: id, slot_id: slotId }, now);
      return { ...waitSnapshot(entry(id), now), replayed: false };
    });
  }
  function getUserWaitlist(userId) {
    user(userId);
    const now = utcTimestamp(clock);
    return database(() => db.prepare('SELECT * FROM waitlist_entries WHERE user_id = ? ORDER BY id').all(userId).map(row => waitSnapshot(row, now)));
  }
  function getWaitlistPosition(userId, slotId) {
    user(userId); slot(slotId);
    const found = db.prepare('SELECT * FROM waitlist_entries WHERE user_id = ? AND service_slot_id = ? ORDER BY id DESC LIMIT 1').get(userId, slotId);
    return found ? waitSnapshot(found, utcTimestamp(clock)) : null;
  }
  function cancelWaitlistEntry(entryId, userId) {
    positiveId(userId, 'userId');
    const initial = entry(entryId);
    return mutation([initial.service_slot_id], now => {
      const current = entry(entryId); own(current, userId);
      if (current.status === 'cancelled') return { ...waitSnapshot(current, now), replayed: true };
      if (!['waiting','offered'].includes(current.status)) throw new ReservationError('INVALID_WAITLIST_STATE', 'Only waiting or offered entries can be cancelled.', 409);
      db.prepare("UPDATE waitlist_entries SET status = 'cancelled' WHERE id = ?").run(entryId);
      emit('waitlist_cancelled', userId, null, { entry_id: entryId, slot_id: current.service_slot_id, reason: 'user_cancelled' }, now);
      maintain(slot(current.service_slot_id), now);
      return waitSnapshot(entry(entryId), now);
    });
  }
  function offerAvailableSlot(slotId) {
    positiveId(slotId, 'slotId');
    return database(() => transaction(() => {
      const selectedSlot = slot(slotId); requireReservable(selectedSlot);
      return maintain(selectedSlot, utcTimestamp(clock));
    }));
  }
  function acceptWaitlistOffer(entryId, userId) {
    positiveId(userId, 'userId');
    const initial = entry(entryId);
    return mutation([initial.service_slot_id], now => {
      const current = entry(entryId); own(current, userId);
      if (current.status === 'accepted') return resSnapshot(reservation(current.reservation_id), true);
      if (current.status === 'expired') throw new ReservationError('OFFER_EXPIRED', 'This offer has expired; rejoin the waitlist if desired.', 410);
      if (current.status !== 'offered') throw new ReservationError('OFFER_NOT_AVAILABLE', 'This entry has no outstanding offer.', 409);
      const selectedSlot = slot(current.service_slot_id); allowed(userId, selectedSlot); duplicate(userId, selectedSlot.id);
      if (current.offer_expires_at <= now) throw new ReservationError('OFFER_EXPIRED', 'This offer has expired.', 410);
      const inventory = availability(selectedSlot, now);
      if (inventory.occupied + inventory.held > selectedSlot.capacity) throw new ReservationError('SLOT_FULL', 'Slot inventory changed; the offer cannot be accepted.', 409);
      const key = `waitlist:${entryId}`;
      if (db.prepare('SELECT id FROM reservations WHERE user_id = ? AND idempotency_key = ?').get(userId, key)) {
        throw new ReservationError('IDEMPOTENCY_CONFLICT', 'The offer key conflicts with a previous operation.', 409);
      }
      const created = insertReservation(userId, selectedSlot.id, key, now, 'waitlist', entryId);
      db.prepare("UPDATE waitlist_entries SET status = 'accepted', reservation_id = ? WHERE id = ?").run(created.id, entryId);
      emit('waitlist_offer_accepted', userId, created.id, { entry_id: entryId, slot_id: selectedSlot.id }, now);
      return created;
    });
  }
  function replaceReservation(reservationId, userId, newSlotId, key) {
    positiveId(userId, 'userId'); positiveId(newSlotId, 'newSlotId'); idempotencyKey(key);
    const initial = reservation(reservationId);
    return mutation([initial.service_slot_id, newSlotId], now => {
      const current = reservation(reservationId); own(current, userId);
      const previous = replay(userId, newSlotId, key, 'replace', reservationId);
      if (previous) return previous;
      if (current.status !== 'confirmed') throw new ReservationError('INVALID_RESERVATION_STATE', 'Only confirmed reservations can be replaced.', 409);
      if (current.service_slot_id === newSlotId) throw new ReservationError('INVALID_INPUT', 'Choose a different slot; same-slot edits do not require a new booking.');
      const target = slot(newSlotId); allowed(userId, target); duplicate(userId, newSlotId);
      noOutstandingOffer(userId, newSlotId);
      if (availability(target, now).available <= 0) throw new ReservationError('SLOT_FULL', 'Replacement slot is full or held; the current reservation is preserved.', 409);
      db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = ?, cancelled_at = ? WHERE id = ?").run(now, now, reservationId);
      emit('reservation_cancelled', userId, reservationId, { slot_id: current.service_slot_id, reason: 'replacement' }, now);
      const created = insertReservation(userId, newSlotId, key, now, 'replace', null, reservationId);
      emit('reservation_replaced', userId, created.id, { previous_reservation_id: reservationId, slot_id: newSlotId }, now);
      maintain(slot(current.service_slot_id), now);
      return created;
    });
  }

  // Operator inventory controls use the same connection, transaction and validation boundary.
  function createServiceSlot(input) {
    const { loungeServiceId, date, start, end, capacity } = input || {};
    positiveId(loungeServiceId, 'loungeServiceId'); serviceDate(date);
    if (![start,end].every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || start >= end || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
      throw new ReservationError('INVALID_INPUT', '日期、時間或容量無效。');
    }
    return database(() => transaction(() => {
      const link = db.prepare(`SELECT ls.*, s.default_duration_minutes, l.opening_time, l.closing_time, l.active AS lounge_active
        FROM lounge_services ls JOIN services s ON s.id=ls.service_id JOIN lounges l ON l.id=ls.lounge_id WHERE ls.id=?`).get(loungeServiceId);
      if (!link || !link.active || !link.lounge_active) throw new ReservationError('INVALID_INPUT', '請選擇已啟用的貴賓室服務。');
      if (link.reservation_mode === 'walk_in') throw new ReservationError('WALK_IN_ONLY', '臨時到訪服務不設預約時段。', 409);
      const minutes = t => Number(t.slice(0,2))*60+Number(t.slice(3));
      if (minutes(end)-minutes(start) !== link.default_duration_minutes || start < link.opening_time || end > link.closing_time) throw new ReservationError('INVALID_INPUT', '時段須符合服務時長及示範營業時間。');
      if (db.prepare('SELECT id FROM service_slots WHERE lounge_service_id=? AND service_date=? AND start_time < ? AND end_time > ?').get(loungeServiceId,date,end,start)) throw new ReservationError('SLOT_CONFLICT', '此服務已有重疊時段（包括已停用時段）。',409);
      const id = db.prepare('SELECT coalesce(max(id),0)+1 AS id FROM service_slots').get().id;
      db.prepare('INSERT INTO service_slots(id,lounge_service_id,service_date,start_time,end_time,capacity,active) VALUES (?,?,?,?,?,?,1)').run(id,loungeServiceId,date,start,end,capacity);
      emit('slot_created',null,null,{slot_id:id},utcTimestamp(clock));
      return availability(slot(id),utcTimestamp(clock));
    }));
  }
  function updateServiceSlot(slotId, changes) {
    positiveId(slotId,'slotId');
    if (!changes || !Object.keys(changes).length || Object.keys(changes).some(k => !['capacity','active'].includes(k)) || (changes.active !== undefined && typeof changes.active !== 'boolean') || (changes.capacity !== undefined && (!Number.isInteger(changes.capacity) || changes.capacity < 1 || changes.capacity > 1000))) throw new ReservationError('INVALID_INPUT','容量或啟用狀態無效。');
    return database(() => transaction(() => {
      const selected = slot(slotId), now=utcTimestamp(clock);
      maintain(selected,now);
      const inventory=availability(selected,now);
      if (changes.capacity !== undefined && changes.capacity < inventory.occupied+inventory.held) throw new ReservationError('CAPACITY_FLOOR','容量不能少於已佔用及邀請保留名額。',409);
      if (changes.active === false && (inventory.occupied || inventory.held || inventory.waiting_count)) throw new ReservationError('SLOT_IN_USE','請先處理現有預約及候補，才可停用時段。',409);
      db.prepare('UPDATE service_slots SET capacity=?,active=? WHERE id=?').run(changes.capacity ?? selected.capacity,changes.active === undefined ? selected.active : Number(changes.active),slotId);
      maintain(slot(slotId),now);
      emit('slot_updated',null,null,{slot_id:slotId,...changes},now);
      return availability(slot(slotId),now);
    }));
  }
  function removeServiceSlot(slotId) { return updateServiceSlot(slotId,{active:false}); }

  return Object.freeze({ createServiceSlot, updateServiceSlot, removeServiceSlot, listLounges, listServices, listAvailableSlots, getSlotAvailability, createReservation,
    getUserReservations, cancelReservation, joinWaitlist, cancelWaitlistEntry, getWaitlistPosition,
    getUserWaitlist, offerAvailableSlot, acceptWaitlistOffer, replaceReservation });
}

module.exports = { createReservationService };
