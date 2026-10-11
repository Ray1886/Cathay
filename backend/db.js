'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;
const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'lounge-demo.sqlite');

function withTransaction(db, operation) {
  if (db.isTransaction) throw new Error('Nested transactions are not supported.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    if (result && typeof result.then === 'function') {
      throw new TypeError('Database transactions must be synchronous; do not await network or LLM calls.');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function openDatabase({ filename = ':memory:', timeout = 5000 } = {}) {
  if (typeof filename !== 'string' || !filename || filename.includes('\0')) throw new TypeError('filename must be a nonempty path.');
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 30000) throw new TypeError('timeout must be an integer from 0 to 30000 milliseconds.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 15) {
    throw new Error('Use Node.js 24.15.0 or newer (the supported demo runtime is Node 24.x).');
  }
  const resolved = filename === ':memory:' ? filename : path.resolve(filename);
  if (resolved !== ':memory:') fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved, { timeout, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
    const mode = db.prepare('PRAGMA journal_mode = WAL').get().journal_mode;
    if (resolved !== ':memory:' && mode !== 'wal') throw new Error('Could not enable SQLite WAL mode. Use a local filesystem.');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) throw new Error(`Database schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`);
    if (version < SCHEMA_VERSION) {
      const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
      withTransaction(db, () => { db.exec(schema); db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); });
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

module.exports = { openDatabase, withTransaction, DEFAULT_DATABASE_PATH, SCHEMA_VERSION };
