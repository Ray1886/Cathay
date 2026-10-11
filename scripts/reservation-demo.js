'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { openDatabase } = require('../backend/db');
const { createReservationService } = require('../backend/reservation-service');
const { seedDatabase, DEMO_DATE, DEMO_USERS, DEMO_SLOTS } = require('../database/seed');

function startServerProcess(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'demo-server.js'), '--db', filename, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let ready = false;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('The local demo server did not start within 10 seconds.')); }, 10_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-8192);
      const address = stdout.match(/Local reservation demo: http:\/\/127\.0\.0\.1:(\d+)/);
      if (address && !ready) { ready = true; clearTimeout(timeout); resolve({ child, port: Number(address[1]) }); }
    });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timeout); if (!ready) reject(new Error(stderr.trim() || `The local demo server exited before startup (${code ?? signal}).`)); });
  });
}

function stopServerProcess(running) {
  if (running.child.exitCode !== null || running.child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { running.child.kill('SIGKILL'); }, 5_000);
    running.child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    running.child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 || signal === 'SIGTERM') resolve();
      else reject(new Error(`The local demo server did not stop cleanly (${code ?? signal}).`));
    });
    running.child.kill('SIGTERM');
  });
}

async function runDemo({ filename } = {}) {
  let tempDirectory;
  if (filename !== undefined) {
    if (typeof filename !== 'string' || !filename || filename === ':memory:') throw new Error('--db must be a literal SQLite filename.');
    filename = path.resolve(filename);
    if (existsSync(filename) && statSync(filename).size > 0) throw new Error('Refusing to run the scripted demo against a nonempty existing database. Choose a new filename.');
  } else {
    tempDirectory = mkdtempSync(path.join(tmpdir(), 'cathay-reservation-demo-'));
    filename = path.join(tempDirectory, 'demo.sqlite');
  }
  let running; let db;
  try {
    db = openDatabase({ filename }); seedDatabase(db);
    const service = createReservationService({ db });
    running = await startServerProcess(filename);
    const slot = service.getSlotAvailability(DEMO_SLOTS.lastMassage);
    assert.equal(slot.service_date, DEMO_DATE);
    assert.equal(slot.start_time, '18:40');
    assert.equal(slot.available, 1);
    assert.equal(service.getSlotAvailability(DEMO_SLOTS.fullMassage).available, 0);
    const reservationA = service.createReservation(DEMO_USERS.a, DEMO_SLOTS.lastMassage, 'demo-a-last-massage');
    assert.throws(() => service.createReservation(DEMO_USERS.b, DEMO_SLOTS.lastMassage, 'demo-b-full-massage'), { code: 'SLOT_FULL' });
    const waitingB = service.joinWaitlist(DEMO_USERS.b, DEMO_SLOTS.lastMassage);
    assert.equal(waitingB.position, 1);
    service.cancelReservation(reservationA.id ?? reservationA.reservation_id, DEMO_USERS.a);
    const offeredB = service.getWaitlistPosition(DEMO_USERS.b, DEMO_SLOTS.lastMassage);
    assert.equal(offeredB.status, 'offered');
    assert.equal(offeredB.position, 0);
    const duringOffer = service.getSlotAvailability(DEMO_SLOTS.lastMassage);
    assert.equal(duringOffer.occupied, 0); assert.equal(duringOffer.held, 1); assert.equal(duringOffer.available, 0);
    assert.deepEqual(service.offerAvailableSlot(DEMO_SLOTS.lastMassage), []);
    const reservationB = service.acceptWaitlistOffer(offeredB.entry_id, DEMO_USERS.b);
    const reservationId = reservationB.id ?? reservationB.reservation_id;
    const finalInventory = service.getSlotAvailability(DEMO_SLOTS.lastMassage);
    assert.equal(finalInventory.occupied, 1); assert.equal(finalInventory.held, 0); assert.equal(finalInventory.available, 0);
    // Close the scripting connection and terminate the standalone server
    // process. Its replacement opens the same SQLite file independently.
    db.close(); db = undefined;
    await stopServerProcess(running); running = undefined;
    running = await startServerProcess(filename);
    const response = await fetch(`http://127.0.0.1:${running.port}/api/users/${DEMO_USERS.b}/reservations`, { headers: { 'X-Demo-User-Id': String(DEMO_USERS.b) } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const persisted = payload.data.find((row) => (row.id ?? row.reservation_id) === reservationId);
    assert.ok(persisted); assert.equal(persisted.status, 'confirmed');
    const inventoryResponse = await fetch(`http://127.0.0.1:${running.port}/api/slots/${DEMO_SLOTS.lastMassage}/availability`);
    assert.equal(inventoryResponse.status, 200);
    const inventory = (await inventoryResponse.json()).data;
    assert.equal(inventory.occupied, 1); assert.equal(inventory.held, 0); assert.equal(inventory.available, 0);
    return { date: DEMO_DATE, slot_id: DEMO_SLOTS.lastMassage, reservation_id: reservationId, occupied: 1, held: 0, available: 0, server_restart_persistence: true, server_process_restart_persistence: true, ...(tempDirectory ? { temporary_database_removed: true } : { database: filename }) };
  } finally {
    try { if (running) await stopServerProcess(running); }
    finally { if (db) db.close(); if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true }); }
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return {};
  if (argv.length !== 2 || argv[0] !== '--db' || !argv[1]) throw new Error('Usage: node scripts/reservation-demo.js [--db new-filename.sqlite]');
  return { filename: argv[1] };
}

if (require.main === module) {
  Promise.resolve().then(() => runDemo(parseArgs(process.argv.slice(2)))).then((result) => {
    console.log('A booked the last 18:40 massage; B was rejected at full capacity and joined the waitlist.');
    console.log('A cancelled; B received the automatic held offer and accepted it.');
    console.log('Standalone HTTP server process and SQLite restarted: B’s confirmed reservation persisted.');
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { runDemo };
