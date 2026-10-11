# Reservation prototype

This is a local, dependency-free reservation backend for the existing lounge itinerary prototype. It uses CommonJS and Node's built-in `node:sqlite`. The browser UI still uses its original simulated booking state; these backend modules do not change `app.js`, `index.html`, flights, or gates.

All seeded inventory, facilities, eligibility rules, and availability are deliberately fictional demo data. Lounge names are labels for the demonstration, not statements about actual Cathay facilities or access policies. No request reaches a Cathay booking system.

## Start on Windows

Use **Node >=24.15.0 and <25**. No npm packages, Python, or C++ build tools are required for this backend. Run these commands in the repository directory in PowerShell:

```powershell
node --version
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); console.log(db.prepare('SELECT sqlite_version() AS version').get()); db.close();"
npm.cmd test
npm.cmd run db:init
npm.cmd run demo:reservations
npm.cmd run reservations:server
```

The HTTP demo listens on `http://127.0.0.1:4174`. It exposes the JSON API described in [api.md](api.md); it does not serve or connect the existing UI. The existing `server.js` still serves the UI, DeepSeek chat, and fixed `/api/availability` data at port 8765; `npm.cmd start` is an alias for `node server.js`. Stop either server with Ctrl+C. `db:init` uses `data/lounge-demo.sqlite`: a complete known seed is preserved, and a partial/unrelated nonempty database is rejected. It never resets existing rows.

The scripts also run directly with Node, without npm:

```powershell
node database/seed.js
node scripts/reservation-demo.js
node backend/demo-server.js --db data/lounge-demo.sqlite --port 4174
```

For a separate seed, use `node database/seed.js --db data/my-demo.sqlite --date 2026-11-01`. Rerunning a known seed preserves its original dates and bookings rather than merging/resetting it.

## Demo fixtures

The fixture date is **2026-11-01**. Slot dates and `HH:MM` times are airport-local Hong Kong time (`Asia/Hong_Kong`, UTC+08:00 for this demo); lifecycle timestamps are UTC ISO strings ending in `Z`.

| User | ID | Demo tier |
| --- | --- | --- |
| A / Demo Passenger A | 1 | `first` |
| B / Demo Passenger B | 2 | `diamond` |
| C / Demo Passenger C | 3 | `gold` |
| Demo Standard Passenger | 4 | `standard` |

| Slot ID | Fixture purpose |
| --- | --- |
| 1001 | One free massage place at 18:40; use it for the last-place race |
| 1002 | Massage at 18:20–18:35, capacity one, initially full |
| 1003 | Shower at 17:30–18:00, capacity two |
| 1004 | Optional rest at 18:00–18:20, capacity one |

The five lounge labels are The Wing First, The Pier First, The Wing Business, The Pier Business, and The Deck. There are five service codes: `shower`, `dining`, `massage`, `rest`, and `work`. Additional slots 1005–1008 exercise other lounge rules, including optional work at 1007. The `gate` activity remains a journey event and is not inventory. The rules determine which fixture services require reservations; inclusion in the catalog does not imply every service is bookable.

## Scripted demonstration

`demo:reservations` starts a standalone HTTP server in a child Node process. The script's separate connection books the last 18:40 massage for A, rejects B's booking at full capacity, queues B, cancels A, verifies B's held offer, and accepts it. It then closes its connection, terminates the server process, starts a fresh server process against the same file, and verifies B's confirmed reservation and capacity through HTTP GETs.

The default database is temporary and removed on completion. `node scripts/reservation-demo.js --db data/new-demo.sqlite` retains a new file for inspection but refuses a nonempty existing file. It does not overwrite the development database.

## Behavior and boundaries

- Capacity counts noncancelled reservations and unexpired offered holds. Booking, replacement, cancellation, offer acceptance, and waitlist promotion use database transactions.
- Waitlist order is persisted FIFO. Cancellation and expiration can offer freed capacity to the next eligible waiter. An offer holds capacity for five minutes by default; it creates no confirmed reservation until accepted.
- Booking and acceptance return database records with `snake_case` fields and a `replayed` indicator. Reusing a mutation key with different input is rejected.
- Ownership is enforced by the service. `X-Demo-User-Id` selects a controlled demo identity in the HTTP adapter; it is not authentication.
- Agent tools can inspect inventory and propose mutations. A separate trusted approval step commits them. No DeepSeek calls or model-generated SQL participate in this phase.

See [schema.md](schema.md) for constraints and lifecycle details, [api.md](api.md) for library/HTTP/tool contracts, and [integration.md](integration.md) for the frontend migration and future server mounting guide.

## Runtime choice and verification

The built-in driver avoids an additional native-addon installation step on Windows. Node added the `timeout` constructor option and `database.isTransaction` in 24.0.0, and marked `node:sqlite` a **release candidate**, Stability 1.2, in 24.15.0. It has not reached Stability 2. [Official Node 24 SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

`better-sqlite3` also supports immediate transactions, but adds a native addon with its own installation requirements. The built-in driver keeps this phase dependency-free. [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md), [Windows installation guidance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md)

The recommended minimum also includes SQLite **3.51.3**: that is the version in the [Node 24.15.0 tagged SQLite header](https://raw.githubusercontent.com/nodejs/node/v24.15.0/deps/sqlite/sqlite3.h). SQLite fixed a rare multi-connection WAL corruption race in that release. [SQLite WAL-reset fix](https://www.sqlite.org/wal.html#walreset)

Local execution was checked with Node **24.19.0** on macOS. PowerShell commands are provided for Windows, but this local run does not establish that Windows execution has been verified. `npm test` includes all existing itinerary, proposal-preview/confirmation, DeepSeek server, planner, and voice tests as well as the reservation tests. DeepSeek tests use injected mock responses, not live API requests.
