# Integrating the reservation backend

> 更新：主项目已完成时段预约界面整合。当前实现见 [frontend.md](frontend.md)。以下内容保留为独立后端阶段的迁移设计，里面“尚未挂载”“静态候补”等描述不再代表最新主项目状态。

## Current repository

`index.html` loads `itinerary.js` and `app.js` as classic browser scripts. `itinerary.js` exposes `ItineraryEngine` in the browser and CommonJS exports in Node. `app.js` exports `parseTypes`, `planActivities`, and `voiceErrorMessage` for Node tests. `server.js` uses native HTTP and CommonJS, with DeepSeek chat/tool-call handling. The new backend follows CommonJS; changing the root package to `"type": "module"` would break existing `require()` calls and needs a coordinated migration.

The current frontend stores an activity array under `lounge-itinerary-v2` in `localStorage`:

```js
{ id, type, start, end, locationId, venue, status }
```

Its statuses are `added`, `pending`, `confirmed`, and `none`. Its IDs identify browser activities, not database rows. Arrival time, preference history, and booking warnings use `lounge-arrival-time-v1`, `lounge-preference-history-v1`, and `lounge-booking-alerts-v1`; the gate uses `lounge-itinerary-v2-gate`. `save()` persists local activity data and warnings, without booking inventory.

`TYPES` derives service definitions from `ItineraryEngine.SERVICES` and adds icons and fixed example times. `renderServices()` renders those times and infers its badges from local activities. `showWaitlist()` fetches `/api/availability`, falling back to `ItineraryEngine.DEMO_AVAILABILITY`; `waitlistContent()` displays its static counts. The server returns that constant, without reservations, holds, queue membership, or ownership checks. There is no `confirmMassage()` in this revision.

DeepSeek currently calls only `propose_itinerary_change`. `stageProposal()` creates a draft, diff, warnings and a base signature. `decideProposal()` validates that signature, applies the accepted draft, and saves it locally. `itinerary.js` changes an edited confirmed activity to `pending`, and warns that removing an activity does not cancel an actual booking. None of these actions currently changes database records.

This phase leaves `app.js`, `index.html`, `styles.css`, `itinerary.js`, `server.js`, and existing tests unchanged. The standalone reservation server is a separate entry point at port 4174. The existing main server continues at port 8765. The newly added `package.json` has no dependencies and preserves CommonJS; `npm start` simply runs the existing main server.

## Frontend migration, future work

Keep itinerary activities and reservation records separate. An activity needs its own local ID plus optional `slotId`, `reservationId`, and `waitlistEntryId`; these database IDs must come from API results. Keep `gate` and the existing flight/gate display in the itinerary only.

1. Fetch the lounge/service catalog and slots for the selected airport-local date. Render `reservation_mode`, eligibility and real local database availability rather than inferring bookability from an activity type, its fixed `TYPES[type].slots`, or its local badge.
2. Before booking, display the specific slot, lounge, time, and action for user confirmation. Generate and retain an idempotency key for that attempt. Reuse it after an ambiguous network failure; use a new key for a different operation.
3. Send a request for each explicitly approved booking operation. Store returned reservation IDs and refresh availability. Keep `added` for planned activities; show `confirmed` only when a corresponding database record is confirmed. Previously saved local `confirmed` labels are not proof of a booking and must not be imported as reservations.
4. On a full slot, show a distinct join-waitlist action. Track `waiting`, `offered`, `accepted`, `cancelled`, and `expired` separately. An offered entry is a time-limited hold, not confirmation; accepting it returns the reservation record.
5. Cancelling an activity with a confirmed reservation must first cancel the server record. Removing a local itinerary row alone does not release capacity. Use the replacement endpoint to change a booked slot atomically instead of cancel-then-book.
6. On reload, fetch the user's server reservations and waitlist entries. Persist only itinerary preferences in `localStorage`; derive booking state from the server. Expired/cancelled records remain historical records and must not render as confirmed.

Availability can change between rendering and mutation. A conflict response should trigger a refresh and a clear choice, not an optimistic confirmed badge. A hold's `offer_expires_at` is UTC; convert it for display without treating an airport-local slot time as UTC. Existing `start`/`end` values have no date or offset, so integration must add the chosen slot date and lounge timezone. The current service does not reject past slots or check boarding feasibility; integrate those itinerary checks separately.

The frontend location IDs (`wing`, `deck`, `gate`) are separate from numeric database lounge IDs. The deterministic fixtures use Wing First = 1 and The Deck = 5, but integrations should resolve explicit lounge IDs from the catalog. English seed names also differ from the frontend's Chinese `venue` strings. The current itinerary validator requires its fixed service venue/location, so additional lounges or translated catalog labels require a coordinated validator change; do not silently replace `venue` and break proposal validation. Shared activity codes and default durations match, while seeded facilities and eligibility are fictional and may differ from the frontend's fixed display catalog.

The existing `/api/availability` response is `{source, slots: [{type, start, available, queue}]}`. The new API returns `{data}` with slot IDs, dates, lounges, eligibility, held capacity, and waitlist records. Do not point `showWaitlist()` at a new URL without adapting `waitlistContent()`. Database `waiting` and `offered` require distinct UI states; an offer is not a confirmed reservation.

## Identity and server mounting

The demo server binds to loopback and accepts `X-Demo-User-Id` as its caller identity. It is intended for controlled local demonstrations. The adapter itself checks the loopback client, Host, and any Origin; a frontend opened as `file://` or served on a different development-server port is currently rejected. Serving the future UI from the same loopback server is the simplest local integration.

A deployed server needs a separate authenticated transport: resolve the user from a trusted session and pass that ID to the service, rather than accepting client-selected identity. The current adapter's local-only transport guards and demo header handling must be replaced as part of that work; mounting it alone does not create a public authenticated API.

In a later integration, initialize one database/service outside `createAppServer()`'s per-request callback, then mount the reservation adapter at the start of that callback, before `/api/status`, `/api/availability`, `/api/chat`, and static routing. It returns `false` for paths it does not handle, so those requests can continue to the existing handler. Handled routes return JSON; a recognized route with the wrong method returns 405. See [api.md](api.md) for the exact constructor and route contracts. This guide does not mount it in the current `server.js`.

```js
const { createReservationApi } = require('./backend/reservation-api.js');
// Initialize/open the database and createReservationService once at startup.
const reservationApi = createReservationApi({ service });

// Inside createAppServer()'s existing async request handler, in a future change:
if (await reservationApi(req, res)) return;
// Continue to the existing /api/status, /api/chat and static-file routing.
```

The adapter is asynchronous only while reading HTTP bodies; it calls the synchronous service after the full input is parsed. Do not hold a database transaction while receiving request bytes.

Use an explicit absolute database path when integrating into another entry point. Resolve paths from the module/repository location rather than whichever directory launched the process. Both processes must access the same database file to share capacity; separate files create separate inventories.

Check integration points before mounting:

| Area | Current state | Required coordinated change |
| --- | --- | --- |
| Main server | `createAppServer()` in `server.js`, port 8765 | Mount before existing routes, close the database on shutdown; keep standalone port 4174 separate |
| Modules | Browser classic script plus CommonJS tests/backend | Preserve the root CommonJS setting or migrate callers together |
| Package scripts | Adds `start`, `test`, `test:reservations`, `db:init`, `demo:reservations`, `reservations:server` | Merge future scripts/dependencies instead of replacing this package file |
| Frontend globals | `TYPES`, `clock`, `activities`, `render` in `app.js` | Keep backend `clock` injection and modules out of the browser global scope |
| Persistence | `lounge-itinerary-v2` plus gate/arrival/preferences/warnings keys | Add server IDs and distinct reservation/waitlist rendering; no direct localStorage-to-DB import |
| Availability | `DEMO_AVAILABILITY`, `/api/availability`, `showWaitlist()` | Replace fixed counts with selected-date database slots and user's waitlist entries |
| Locations | `itinerary.js` fixes Chinese venues and `wing`/`deck` IDs | Map catalog IDs deliberately and coordinate additional-lounge validation with the Agent developer |
| DeepSeek/tool orchestration | `PROPOSAL_TOOL`, `extractProposal()`, `stageProposal()`, `decideProposal()` | Add reservation reads/proposals outside transactions; connect trusted approval separately |

## Agent boundary

The model-facing tool object provides reads and mutation proposals. It does not expose the approval/commit function. Present each proposal in trusted UI, obtain explicit approval for that specific action, then call `approveProposal` from the trusted application layer. The approval path rechecks availability, eligibility, ownership, and proposal expiry.

The existing "confirm and save" button approves an itinerary edit, not an unspecified booking, cancellation, or replacement. A future preview must list the exact reservation operations the user is approving. Keep confirmed database reservations unchanged while previewing, cancelling or rejecting an itinerary proposal. Preserve reservation IDs even when the local activity is marked `pending`; that label alone must not cancel or recreate a booking.

Each booking replacement is atomic, but the tool adapter does not atomically commit an entire multi-operation itinerary. A future combined itinerary/booking workflow must define partial failure, batch transactions, or compensation before updating the saved plan. Reservation proposal IDs are in-memory and user-bound, and are distinct from frontend message indexes/base signatures; do not interchange them or expose `approveProposal` as a DeepSeek tool.

An instruction in a conversation, tool argument, or generated JSON is not a trusted approval signal by itself. Do not expose approval as a model tool or let a model send SQL. Keep LLM/network work outside `BEGIN IMMEDIATE`; the service functions and database transactions remain synchronous.

## SQLite operating assumptions

Use one local database file on a writable filesystem. WAL supports multiple processes on the same host and concurrent readers, but retains one writer and cannot coordinate across a network filesystem. Keep write transactions short and let the busy timeout produce a retryable failure when contention persists. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html), [SQLite WAL operating constraints](https://www.sqlite.org/wal.html)

WAL files are part of live database state: do not copy a live `.db` alone or delete its `-wal`/`-shm` companions to reset it. Use SQLite's backup mechanism or close all connections before handling a complete database snapshot. Reads reflect expired deadlines without writing; mutations and explicit offer maintenance persist expiration and promote the queue. A continuously running expiration worker is not part of this prototype.
