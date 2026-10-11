'use strict';

const { openDatabase, withTransaction, DEFAULT_DATABASE_PATH } = require('../backend/db');
const { serviceDate } = require('../backend/reservation-rules');

const DEMO_DATE = '2026-11-01';
const DEMO_USERS = Object.freeze({ a: 1, b: 2, c: 3, standard: 4 });
const DEMO_SLOTS = Object.freeze({ lastMassage: 1001, fullMassage: 1002, shower: 1003, optionalRest: 1004 });
const SEED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function seedDatabase(db, { date = DEMO_DATE } = {}) {
  serviceDate(date);
  return withTransaction(db, () => {
    const tables = ['users', 'lounges', 'services', 'lounge_services', 'service_slots', 'reservations', 'waitlist_entries', 'reservation_events'];
    const populated = tables.filter(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n > 0);
    if (populated.length) {
      // Seed only an empty database: repeating initialization must never undo demo bookings.
      const known = db.prepare('SELECT id FROM users WHERE id = 1 AND display_name = ?').get('Demo Passenger A');
      if (!known || tables.slice(0, 5).some(table => !populated.includes(table))) {
        throw new Error('Database is nonempty and is not a complete known demo seed. Use a new database path.');
      }
      const dates = db.prepare('SELECT DISTINCT service_date FROM service_slots ORDER BY service_date').all();
      return { seeded: false, date: dates[0]?.service_date, mock: true };
    }
    const insertUser = db.prepare('INSERT INTO users(id,display_name,membership_tier,created_at) VALUES (?,?,?,?)');
    [[1,'Demo Passenger A','first'],[2,'Demo Passenger B','diamond'],[3,'Demo Passenger C','gold'],[4,'Demo Standard Passenger','standard']]
      .forEach(row => insertUser.run(...row, SEED_TIMESTAMP));
    const insertLounge = db.prepare('INSERT INTO lounges(id,name,terminal_area,opening_time,closing_time,active) VALUES (?,?,?,?,?,1)');
    ['The Wing First','The Pier First','The Wing Business','The Pier Business','The Deck']
      .forEach((name, index) => insertLounge.run(index + 1, name, 'Synthetic HK Terminal 1', '06:00', '23:30'));
    const insertService = db.prepare('INSERT INTO services(id,code,display_name,default_duration_minutes,category) VALUES (?,?,?,?,?)');
    [[1,'shower','淋浴',30,'wellness'],[2,'dining','用餐',30,'dining'],[3,'massage','按摩',15,'wellness'],[4,'rest','休息 / 日间套房',20,'rest'],[5,'work','工作空间',20,'work']]
      .forEach(row => insertService.run(...row));
    const first = JSON.stringify(['first','diamond']);
    const business = JSON.stringify(['first','business','diamond','gold']);
    const all = JSON.stringify(['first','business','diamond','gold','standard']);
    const insertLink = db.prepare('INSERT INTO lounge_services(id,lounge_id,service_id,reservation_mode,eligible_tiers,preparation_minutes,active) VALUES (?,?,?,?,?,?,1)');
    // All facilities, tiers and capacities below are fictional demo rules, not Cathay facts.
    [[101,1,1,'required',first,5],[102,1,2,'walk_in',first,0],[103,1,3,'required',first,5],[104,1,4,'optional',first,5],[105,1,5,'walk_in',first,0],
      [201,2,1,'required',first,5],[202,2,2,'walk_in',first,0],[203,2,3,'required',first,5],[204,2,4,'optional',first,5],[205,2,5,'walk_in',first,0],
      [301,3,1,'required',business,5],[302,3,2,'walk_in',business,0],[305,3,5,'optional',business,0],
      [401,4,1,'required',business,5],[402,4,2,'walk_in',business,0],[404,4,4,'walk_in',business,0],[405,4,5,'optional',business,0],
      [502,5,2,'walk_in',all,0],[504,5,4,'walk_in',all,0],[505,5,5,'walk_in',all,0]].forEach(row => insertLink.run(...row));
    const insertSlot = db.prepare('INSERT INTO service_slots(id,lounge_service_id,service_date,start_time,end_time,capacity,active) VALUES (?,?,?,?,?,?,1)');
    [[1001,103,'18:40','18:55',1],[1002,103,'18:20','18:35',1],[1003,101,'17:30','18:00',2],[1004,104,'18:00','18:20',1],
      [1005,201,'17:30','18:00',2],[1006,203,'18:40','18:55',1],[1007,305,'18:05','18:25',2],[1008,401,'17:30','18:00',2]]
      .forEach(([id, link, start, end, capacity]) => insertSlot.run(id, link, date, start, end, capacity));
    const booked = db.prepare("INSERT INTO reservations(user_id,service_slot_id,status,created_at,updated_at,idempotency_key) VALUES (1,1002,'confirmed',?,?,'seed:full-massage')")
      .run(SEED_TIMESTAMP, SEED_TIMESTAMP);
    const event = db.prepare('INSERT INTO reservation_events(reservation_id,user_id,event_type,event_payload,created_at) VALUES (?,?,?,?,?)');
    event.run(Number(booked.lastInsertRowid), 1, 'reservation_created', JSON.stringify({ slot_id: 1002, mock: true, source: 'seed' }), SEED_TIMESTAMP);
    event.run(null, null, 'demo_seeded', JSON.stringify({ date, mock: true, note: 'All facilities, capacities, eligibility and booking rules are synthetic.' }), SEED_TIMESTAMP);
    return { seeded: true, date, mock: true };
  });
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    let filename = DEFAULT_DATABASE_PATH;
    let date = DEMO_DATE;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--db' && args[i + 1]) filename = args[++i];
      else if (args[i] === '--date' && args[i + 1]) date = args[++i];
      else throw new Error('Usage: node database/seed.js [--db path] [--date YYYY-MM-DD]');
    }
    const db = openDatabase({ filename });
    try { console.log(JSON.stringify({ database: filename, ...seedDatabase(db, { date }) }, null, 2)); }
    finally { db.close(); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { seedDatabase, DEMO_DATE, DEMO_USERS, DEMO_SLOTS, SEED_TIMESTAMP };
