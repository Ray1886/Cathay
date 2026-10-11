'use strict';

const http = require('node:http');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { createReservationApi } = require('./reservation-api');
const DEFAULT_DEMO_DATABASE = path.join(__dirname, '..', 'data', 'lounge-demo.sqlite');

function createDemoServer({ service }) {
  const handler = createReservationApi({ service });
  const server = http.createServer(async (req, res) => {
    try {
      if (!await handler(req, res)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'The local reservation route does not exist.' } }));
      }
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The reservation request could not be completed.' } }));
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

function listen(server, port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer from 0 to 65535.');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address()); });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

function databaseIsEmpty(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return tables.every(({ name }) => db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count === 0);
}

async function startDemoServer({ filename = DEFAULT_DEMO_DATABASE, port = 4174, seed = true } = {}) {
  const { openDatabase } = require('./db');
  const { seedDatabase } = require('../database/seed');
  const { createReservationService } = require('./reservation-service');
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = openDatabase({ filename });
  let server;
  try {
    if (seed && databaseIsEmpty(db)) seedDatabase(db);
    const service = createReservationService({ db });
    server = createDemoServer({ service });
    const address = await listen(server, port);
    let closed = false;
    return { db, service, server, address, async close() { if (closed) return; closed = true; try { await closeServer(server); } finally { db.close(); } } };
  } catch (error) {
    if (server?.listening) await closeServer(server);
    db.close(); throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--db', '--port'].includes(flag) || argv[i + 1] === undefined) throw new Error('Usage: node backend/demo-server.js [--db filename] [--port 4174]');
    const value = argv[++i];
    if (flag === '--db') options.filename = path.resolve(value);
    else {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 65535) throw new Error('--port must be an integer from 0 to 65535.');
      options.port = Number(value);
    }
  }
  return options;
}

if (require.main === module) {
  Promise.resolve().then(() => startDemoServer(parseArgs(process.argv.slice(2)))).then((running) => {
    console.log(`Local reservation demo: http://127.0.0.1:${running.address.port}`);
    console.log(`SQLite database: ${path.resolve(parseArgs(process.argv.slice(2)).filename || DEFAULT_DEMO_DATABASE)}`);
    console.log('X-Demo-User-Id is controlled local demo identity, not authentication.');
    const stop = async () => { await running.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createDemoServer, startDemoServer, listen, closeServer };
