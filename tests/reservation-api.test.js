'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { openDatabase } = require('../backend/db');
const { seedDatabase, DEMO_DATE, DEMO_USERS, DEMO_SLOTS } = require('../database/seed');
const { createReservationService } = require('../backend/reservation-service');
const { createReservationApi } = require('../backend/reservation-api');
const { createDemoServer, listen, closeServer } = require('../backend/demo-server');

async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'cathay-api-test-'));
  const filename = path.join(directory, 'test.sqlite');
  let db = openDatabase({ filename });
  seedDatabase(db);
  let service = createReservationService({ db, clock: () => new Date('2026-11-01T08:00:00Z') });
  let server = createDemoServer({ service });
  let address = await listen(server, 0);
  t.after(async () => { try { await closeServer(server); } finally { db.close(); rmSync(directory, { recursive: true, force: true }); } });
  return {
    get db() { return db; }, get service() { return service; },
    request(route, { method = 'GET', userId, body, raw, headers = {} } = {}) {
      const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: address.port, path: route, method, headers: { ...(userId === undefined ? {} : { 'X-Demo-User-Id': String(userId) }), ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }), ...headers } }, (res) => {
          let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; });
          res.on('end', () => { try { resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : undefined }); } catch (error) { reject(error); } });
        });
        req.on('error', reject); req.end(payload);
      });
    },
    async restart() {
      await closeServer(server); db.close();
      db = openDatabase({ filename }); service = createReservationService({ db, clock: () => new Date('2026-11-01T08:00:00Z') });
      server = createDemoServer({ service }); address = await listen(server, 0);
    }
  };
}

test('catalog, availability, alias and method routing return consistent JSON', async (t) => {
  const f = await fixture(t);
  const lounges = await f.request('/api/lounges');
  assert.equal(lounges.status, 200); assert.ok(lounges.body.data.length > 0);
  const services = await f.request(`/api/lounges/${lounges.body.data[0].id}/services`, { userId: DEMO_USERS.a });
  assert.equal(services.status, 200); assert.ok(Array.isArray(services.body.data));
  const slots = await f.request(`/api/services/slots?date=${DEMO_DATE}&includeFull=true`, { userId: DEMO_USERS.a });
  const alias = await f.request(`/api/slots?date=${DEMO_DATE}&includeFull=true`, { userId: DEMO_USERS.a });
  assert.equal(slots.status, 200); assert.deepEqual(alias.body, slots.body);
  const availability = await f.request(`/api/slots/${DEMO_SLOTS.lastMassage}/availability`);
  assert.equal(availability.body.data.available, 1);
  const wrongMethod = await f.request('/api/lounges', { method: 'POST', body: {} });
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.allow, 'GET'); assert.equal(wrongMethod.body.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal((await f.request('/api/does-not-exist')).status, 404);
  assert.equal(await createReservationApi({ service: f.service })({ url: '/other/path' }, {}), false);
});

test('booking and waitlist flow counts held capacity and survives HTTP server restart', async (t) => {
  const f = await fixture(t);
  const booking = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body: { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'http-a-booking' } });
  assert.equal(booking.status, 201); assert.equal(booking.body.data.replayed, false);
  const replay = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body: { slotId: DEMO_SLOTS.lastMassage }, headers: { 'Idempotency-Key': 'http-a-booking' } });
  assert.equal(replay.status, 200); assert.equal(replay.body.data.id, booking.body.data.id); assert.equal(replay.body.data.replayed, true);
  const full = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.b, body: { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'http-b-full' } });
  assert.equal(full.status, 409); assert.equal(full.body.error.code, 'SLOT_FULL');
  const waiting = await f.request('/api/waitlist', { method: 'POST', userId: DEMO_USERS.b, body: { slotId: DEMO_SLOTS.lastMassage } });
  assert.equal(waiting.status, 201); assert.equal(waiting.body.data.position, 1);
  const cancelled = await f.request(`/api/reservations/${booking.body.data.id}`, { method: 'DELETE', userId: DEMO_USERS.a });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.status, 'cancelled');
  const position = await f.request(`/api/waitlist/position?slotId=${DEMO_SLOTS.lastMassage}`, { userId: DEMO_USERS.b });
  assert.equal(position.body.data.status, 'offered'); assert.equal(position.body.data.position, 0);
  const held = await f.request(`/api/slots/${DEMO_SLOTS.lastMassage}/availability`);
  assert.equal(held.body.data.held, 1); assert.equal(held.body.data.occupied, 0); assert.equal(held.body.data.available, 0);
  const accepted = await f.request(`/api/waitlist/${position.body.data.entry_id}/accept`, { method: 'POST', userId: DEMO_USERS.b, body: {} });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.data.status, 'confirmed');
  const acceptedReplay = await f.request(`/api/waitlist/${position.body.data.entry_id}/accept`, { method: 'POST', userId: DEMO_USERS.b, body: {} });
  assert.equal(acceptedReplay.body.data.id, accepted.body.data.id); assert.equal(acceptedReplay.body.data.replayed, true);
  await f.restart();
  const persisted = await f.request(`/api/users/${DEMO_USERS.b}/reservations?status=confirmed`, { userId: DEMO_USERS.b });
  assert.ok(persisted.body.data.some((row) => row.id === accepted.body.data.id));
  const final = await f.request(`/api/slots/${DEMO_SLOTS.lastMassage}/availability`);
  assert.equal(final.body.data.occupied, 1); assert.equal(final.body.data.held, 0); assert.equal(final.body.data.available, 0);
});

test('demo identity cannot be overridden by route or body and private actions require it', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/reservations', { method: 'POST', body: { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'missing-user' } })).status, 401);
  assert.equal((await f.request(`/api/users/${DEMO_USERS.a}/reservations`, { userId: DEMO_USERS.b })).status, 403);
  const mismatch = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body: { userId: DEMO_USERS.b, slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'mismatch' } });
  assert.equal(mismatch.status, 403); assert.equal(mismatch.body.error.code, 'IDENTITY_MISMATCH');
  const booking = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body: { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'own-booking' } });
  const crossCancel = await f.request(`/api/reservations/${booking.body.data.id}`, { method: 'DELETE', userId: DEMO_USERS.b });
  assert.ok([403, 404].includes(crossCancel.status));
  const bodyCancel = await f.request(`/api/reservations/${booking.body.data.id}`, { method: 'DELETE', userId: DEMO_USERS.a, body: { userId: DEMO_USERS.b } });
  assert.equal(bodyCancel.status, 403);
  assert.equal(f.service.getSlotAvailability(DEMO_SLOTS.lastMassage).occupied, 1);
});

test('Host, Origin and peer guard reject nonlocal access without wildcard CORS', async (t) => {
  const f = await fixture(t);
  const host = await f.request('/api/lounges', { headers: { Host: 'attacker.example' } });
  assert.equal(host.status, 403); assert.equal(host.body.error.code, 'INVALID_HOST');
  const origin = await f.request('/api/lounges', { headers: { Origin: 'https://attacker.example' } });
  assert.equal(origin.status, 403); assert.equal(origin.body.error.code, 'INVALID_ORIGIN');
  const fileOrigin = await f.request('/api/lounges', { headers: { Origin: 'null' } });
  assert.equal(fileOrigin.status, 403); assert.equal(fileOrigin.headers['access-control-allow-origin'], undefined);
  let response;
  const handled = await createReservationApi({ service: f.service })({ url: '/api/lounges', method: 'GET', socket: { remoteAddress: '10.0.0.7', localPort: 4174 }, headers: { host: '127.0.0.1:4174' } }, { writeHead(status) { response = { status }; }, end(body) { response.body = JSON.parse(body); } });
  assert.equal(handled, true); assert.equal(response.status, 403); assert.equal(response.body.error.code, 'LOCAL_ONLY');
});

test('invalid inputs, malformed JSON and oversized bodies do not mutate reservations', async (t) => {
  const f = await fixture(t);
  const before = f.service.getUserReservations(DEMO_USERS.a, {}).length;
  for (const body of [{ slotId: 0, idempotencyKey: 'bad-id' }, { slotId: '1001', idempotencyKey: 'string-id' }, { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'has spaces' }, { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'unknown', unknown: true }]) {
    assert.equal((await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body })).status, 400);
  }
  const malformed = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, raw: '{broken' });
  assert.equal(malformed.status, 400); assert.equal(malformed.body.error.code, 'INVALID_JSON');
  const huge = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, raw: JSON.stringify({ value: 'x'.repeat(17000) }) });
  assert.equal(huge.status, 413);
  const mediaType = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body: {}, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(mediaType.status, 415);
  assert.equal((await f.request('/api/services/slots?date=2026-02-30')).status, 400);
  assert.equal((await f.request(`/api/services/slots?date=${DEMO_DATE}&date=${DEMO_DATE}`)).status, 400);
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).length, before);
});

test('waitlist cancellation and atomic replacement are available only to the bound user', async (t) => {
  const f = await fixture(t);
  const waiting = await f.request('/api/waitlist', { method: 'POST', userId: DEMO_USERS.b, body: { slotId: DEMO_SLOTS.fullMassage } });
  assert.equal(waiting.status, 201);
  const waitlist = await f.request(`/api/users/${DEMO_USERS.b}/waitlist`, { userId: DEMO_USERS.b });
  assert.ok(waitlist.body.data.some((row) => row.id === waiting.body.data.id));
  const leave = await f.request(`/api/waitlist/${waiting.body.data.id}`, { method: 'DELETE', userId: DEMO_USERS.b });
  assert.equal(leave.status, 200); assert.equal(leave.body.data.status, 'cancelled');
  const booked = await f.request('/api/reservations', { method: 'POST', userId: DEMO_USERS.a, body: { slotId: DEMO_SLOTS.lastMassage, idempotencyKey: 'modify-original' } });
  const replaced = await f.request(`/api/reservations/${booked.body.data.id}/replace`, { method: 'POST', userId: DEMO_USERS.a, body: { newSlotId: DEMO_SLOTS.shower, idempotencyKey: 'modify-new' } });
  assert.equal(replaced.status, 200); assert.equal(replaced.body.data.service_slot_id, DEMO_SLOTS.shower);
  assert.equal(f.service.getUserReservations(DEMO_USERS.a, {}).find((row) => row.id === booked.body.data.id).status, 'cancelled');
});
