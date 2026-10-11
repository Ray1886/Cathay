# Reservation API and agent tools

## Shared conventions

Database IDs are positive safe integers; JSON body IDs must be numbers, not numeric strings. Library input uses `camelCase`; returned database records use `snake_case`. Dates are valid `YYYY-MM-DD` values from 2000–2099 and slot times are airport-local `HH:MM`. Lifecycle timestamps, including an offer's expiry, are UTC ISO strings ending in `Z`. Availability's `start_at`/`end_at` instead have explicit `+08:00` offsets and `timezone: 'Asia/Hong_Kong'`.

The demo API returns JSON:

```json
{ "data": {} }
```

```json
{ "error": { "code": "SLOT_FULL", "message": "The slot is full." } }
```

`data` can be a row, array, or `null`. Errors can also include `details`. Treat `code` as the machine-readable field; do not depend on exact English message wording. Core service domain errors are `ReservationError` objects with `code`, `status`, `message`, and optional `details`. Transport/tool validation errors use the same code/status convention.

POST bodies must be JSON objects with `Content-Type: application/json`, at most 16 KiB. Unknown fields, unknown/duplicate query parameters, invalid dates, and invalid IDs are rejected. Booking/replacement keys are 1–128 ASCII letters/digits or `.`, `_`, `:`, `-`. Either send `idempotencyKey` in the body or the `Idempotency-Key` header; if both are present they must match.

`X-Demo-User-Id` selects a controlled demo user; it is not authentication. The header is optional for catalog queries, which can provide user-specific eligibility when it is present. Mutations and user-specific reads require it. Another user's path/body/query identity is rejected. Do not expose this header-based identity mechanism as a deployed login system.

## HTTP routes

Start with `npm run reservations:server` (`npm.cmd run reservations:server` in PowerShell). The standalone server binds to `127.0.0.1:4174`. Matched paths with an unsupported method return 405; the reusable adapter returns `false` for unknown paths so a host server can handle them.

| Method | Route | Input / result |
| --- | --- | --- |
| GET | `/api/lounges` | Lounge array |
| GET | `/api/lounges/:loungeId/services` | Service/rule array; optional demo identity |
| GET | `/api/services/slots` | Query `date`, optional `loungeId`, `serviceCode`, `includeFull`; slot/availability array |
| GET | `/api/slots/:slotId/availability` | Capacity, noncancelled occupancy, unexpired holds, free capacity |
| POST | `/api/reservations` | `{ "slotId": 1001, "idempotencyKey": "demo-a1-1001-v1" }`; reservation row |
| GET | `/api/users/:userId/reservations` | Own reservation array |
| DELETE | `/api/reservations/:id` | Cancel own reservation; reservation row |
| POST | `/api/reservations/:id/replace` | `{ "newSlotId": 1003, "idempotencyKey": "demo-replace-v1" }`; new reservation row |
| POST | `/api/waitlist` | `{ "slotId": 1001 }`; own waitlist entry |
| GET | `/api/users/:userId/waitlist` | Own waitlist entries |
| GET | `/api/waitlist/position` | Query `slotId`; own position or `null` |
| DELETE | `/api/waitlist/:id` | Leave own waitlist entry |
| POST | `/api/waitlist/:id/accept` | `{}`; accept own live offer and return a reservation |

`/api/services/slots` and `/api/slots` reach the same handler. Reservation listing optionally accepts `?status=confirmed`, `cancelled`, `completed`, or `no_show`. The `services`/`slots`/`position` queries and POST bodies can contain `userId` only if it matches the demo header. A DELETE may omit its body; if supplied, its only allowed field is matching `userId`. These fields cannot select a different actor. Fresh booking and all waitlist-join responses return 201; a replayed booking and all other successful JSON routes return 200. Same-loopback-origin OPTIONS preflights return 204.

Use `includeFull=true` when rendering waitlist choices. Without it, listing includes only `direct_bookable` slots: active, free capacity, and no eligible waiting queue ahead. A supplied user ID also filters by eligibility. `includeFull` bypasses the direct-bookability filter, not active/eligibility checks. `dining` is walk-in in these fixtures and has no slots. Other modes vary by lounge: `work` has an optional seeded slot in The Wing Business, and walk-in work entries elsewhere. Catalog eligibility and slot availability are advisory reads; every mutation checks the rules and capacity again.

Transport checks require a loopback client and a loopback `Host` matching the server port. A supplied browser `Origin` must also use that port; an unrelated site, `file://` page, or separate development-server port cannot call this demo API. The API sets `Cache-Control: no-store` and JSON content type.

### PowerShell example

Run this against the seeded demo server. Slot 1001 initially has one place, so after a successful call other callers can get `SLOT_FULL`.

```powershell
$baseUrl = 'http://127.0.0.1:4174'
$demoHeaders = @{ 'X-Demo-User-Id' = '1' }
Invoke-RestMethod "$baseUrl/api/lounges"
Invoke-RestMethod "$baseUrl/api/slots?date=2026-11-01&includeFull=true" -Headers $demoHeaders
$body = @{ slotId = 1001; idempotencyKey = 'powershell-a1-1001-v1' } | ConvertTo-Json
$booking = Invoke-RestMethod "$baseUrl/api/reservations" -Method Post -Headers $demoHeaders -ContentType 'application/json' -Body $body
$booking.data
Invoke-RestMethod "$baseUrl/api/users/1/reservations" -Headers $demoHeaders
```

Keep the same idempotency key when retrying an uncertain booking response. A repeat returns the same record with `replayed: true`, including when that record has since been cancelled. It does not book a fresh place. A different intent needs a new key; reusing a key with different input returns `IDEMPOTENCY_CONFLICT`.

### Lifecycle responses

A direct booking creates `confirmed`. Joining a full slot creates `waiting`. A later cancellation or offer-maintenance operation can produce `offered` with `offer_expires_at`; that hold consumes capacity without creating a confirmed reservation. Acceptance converts the entry to `accepted` and returns the reservation. Repeating successful acceptance returns the same reservation with `replayed: true`.

GETs and service read methods never write or promote the queue. Once a deadline passes, waitlist reads can report effective `status: 'expired'` alongside `persisted_status: 'offered'`, and availability excludes that expired hold. Mutation/maintenance calls persist expiration and promote eligible waiters. There is no background expiration timer.

A cancelled reservation releases capacity and can automatically offer it to the next eligible waiter. An atomic replacement checks its new slot before releasing the old reservation; a failure preserves the old booking. An expired offer is terminal and cannot be accepted. See [schema.md](schema.md) for the exact state transitions and transaction boundary.

Returned reservation records expose `id`, `reservation_id`, `user_id`, **`service_slot_id`**, `status`, timestamps, `idempotency_key`, `operation`, `waitlist_entry_id`, `replaces_reservation_id`, and `replayed`. Use `service_slot_id` to connect a reservation to a slot. Waitlist records expose `id`, `entry_id`, `user_id`, `service_slot_id`, effective `status`, `persisted_status`, `position`, `offer_expires_at`, `created_at`, and `reservation_id`. Availability exposes `slot_id`/`service_slot_id`, catalog/time fields, `capacity`, `occupied`, `held`, `available`, `waiting_count`, `direct_bookable`, and `active`.

Join repeats return the existing active entry with `replayed: true`. Repeated cancellation is also harmless; acceptance replay returns its linked reservation even if that reservation was later cancelled. Terminal waitlist entries cannot revive; a new join creates a later entry.

| Status | Main error codes / handling |
| --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_JSON`; correct the request |
| 401 | `DEMO_IDENTITY_REQUIRED`; supply the controlled demo header |
| 403 | `FORBIDDEN`, `NOT_ELIGIBLE`, `IDENTITY_MISMATCH`, `LOCAL_ONLY`, `INVALID_HOST`, `INVALID_ORIGIN` |
| 404 | `USER_NOT_FOUND`, `LOUNGE_NOT_FOUND`, `SLOT_NOT_FOUND`, `RESERVATION_NOT_FOUND`, `WAITLIST_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED`; inspect `Allow` |
| 409 | `SLOT_FULL`, `SLOT_AVAILABLE`, `ALREADY_RESERVED`, `WAITLIST_OFFER_PENDING`, `IDEMPOTENCY_CONFLICT`, `SLOT_INACTIVE`, `WALK_IN_ONLY`, `INVALID_RESERVATION_STATE`, `INVALID_WAITLIST_STATE`, `OFFER_NOT_AVAILABLE` |
| 410 | `OFFER_EXPIRED`; the old offer cannot be accepted |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` |
| 503 | `DATABASE_BUSY`; retry the whole operation, preserving its idempotency key |
| 500 | `INTERNAL_ERROR`; an unexpected error is intentionally not exposed |

A rejected mutation can still commit expiration/FIFO maintenance before returning its domain error; it does not commit a failed booking/replacement. For example, an attempted direct booking after a hold expires can return `SLOT_FULL` while the next waiter's offer is successfully persisted.

`WAITLIST_OFFER_PENDING` means the caller already owns a live offer for that target slot. Accept it with the offer's entry ID, or decline it by deleting that waitlist entry. A direct booking/replacement cannot bypass this rule even if another capacity unit is available.

## Synchronous library

Construct the service with a database connection and an injectable clock:

```js
const { openDatabase } = require('./backend/db.js');
const { seedDatabase, DEMO_DATE } = require('./database/seed.js');
const { createReservationService } = require('./backend/reservation-service.js');
const path = require('node:path');

const db = openDatabase({ filename: path.join(__dirname, 'data', 'library-demo.sqlite') });
seedDatabase(db, { date: DEMO_DATE });
const service = createReservationService({
  db,
  clock: () => new Date(),
  offerTtlMs: 5 * 60 * 1000,
});
const reservation = service.createReservation(1, 1001, 'library-a1-1001-v1');
db.close();
```

This example assumes a script in the repository root; adjust imports to the calling file. The database filename must be a writable local path. The library performs no asynchronous I/O or model calls inside transactions. Do not pass an async transaction callback or keep a transaction open across `await`.

| Method | Signature |
| --- | --- |
| `listLounges` | `()` |
| `listServices` | `(loungeId, { userId } = {})` |
| `listAvailableSlots` | `(filters = {})`; optional `date`, `loungeId`, `serviceCode`, `userId`, `includeFull` |
| `getSlotAvailability` | `(slotId)` |
| `getUserReservations` | `(userId, { status } = {})` |
| `createReservation` | `(userId, slotId, idempotencyKey)` |
| `cancelReservation` | `(reservationId, userId)` |
| `replaceReservation` | `(reservationId, userId, newSlotId, idempotencyKey)` |
| `joinWaitlist` | `(userId, slotId)` |
| `getUserWaitlist` | `(userId)` |
| `getWaitlistPosition` | `(userId, slotId)` |
| `cancelWaitlistEntry` | `(entryId, userId)` |
| `acceptWaitlistOffer` | `(entryId, userId)` |
| `offerAvailableSlot` | `(slotId)`; explicitly expire/promote that slot, returning newly offered entries |

`openDatabase({ filename = ':memory:', timeout = 5000 })` initializes schema version 1, accepts timeouts from 0–30000 ms, and returns the synchronous connection. The CLI uses its explicit file path for persistence. `createReservationService` defaults to a real-time `Date` clock and a 300000 ms offer lifetime; `offerTtlMs` accepts 1–3600000 ms. The HTTP slot-list route requires `date`; the library can omit it to query across dates.

## Agent tools and trusted approval

`createReservationTools` returns a model-facing `tools` object containing:

- Reads: `listLounges`, `listServices`, `listAvailableSlots`, `getSlotAvailability`, `getUserReservations`, `getUserWaitlist`, `getWaitlistPosition`.
- Proposals: `proposeBooking`, `proposeCancellation`, `proposeModification`.

The tools are bound to one caller. A proposal returns `{ proposal_id, operation, user_id, expires_at, summary }`; it does not reserve or cancel anything. `operation` is `book`, `cancel`, or `modify`; `summary` contains a slot, a reservation, or the original reservation plus `new_slot`, respectively. Display it in trusted UI. Only the application layer calls `approveProposal(proposalId, { approved: true })` after the user approves that specific proposal. Approval is intentionally absent from the model-facing `tools` object.

```js
const { createReservationTools } = require('./backend/reservation-tools.js');
const adapter = createReservationTools({ service, userId: 1 });
const proposal = adapter.tools.proposeBooking({ slotId: 1001 });
// After trusted UI approval for this exact proposal:
const result = adapter.approveProposal(proposal.proposal_id, { approved: true });
```

The optional tool `clock` defaults to `() => new Date()` and `proposalTtlMs` defaults to five minutes. Pass a consistent clock to the service and tools in deterministic demos/tests. Tool arguments are objects with only the documented fields:

| Tool | Arguments |
| --- | --- |
| `listLounges`, `getUserWaitlist` | `{}` |
| `listServices` | `{ loungeId }` |
| `listAvailableSlots` | `{ date?, loungeId?, serviceCode?, includeFull? }` |
| `getSlotAvailability`, `getWaitlistPosition`, `proposeBooking` | `{ slotId }` |
| `getUserReservations` | `{ status? }` |
| `proposeCancellation` | `{ reservationId }` |
| `proposeModification` | `{ reservationId, newSlotId }` |

Supplying `userId` in a tool argument is rejected; it cannot override the constructor's actor. The adapter remembers a successful approval's record identity; repeating approval reads its current persisted row with `replayed: true` and performs no new mutation. If that reservation was later cancelled, replay reports the cancellation. Uncommitted expired or changed proposals require a new proposal. Approval-specific errors include `APPROVAL_REQUIRED` (403), `PROPOSAL_NOT_FOUND` (404), `PROPOSAL_EXPIRED` (410), and `PROPOSAL_STALE` (409).

Proposal creation can reject a slot with `PROPOSAL_NOT_BOOKABLE` (409), a prior queue with `WAITLIST_PRIORITY` (409), a duplicate with `ALREADY_RESERVED` (409), the caller's own hold with `WAITLIST_OFFER_PENDING` (409), or an inactive original reservation with `RESERVATION_NOT_ACTIVE` (409). These checks are reads and do not allocate a hold.

Approval must come from trusted UI, not model-generated JSON or a tool parameter claiming that the user approved. The service revalidates the operation at commit time; an inventory read or earlier proposal does not guarantee capacity. Proposals are transient process memory, so they are not persistent reservation records and should be recreated after a server restart.

The tool interface is deterministic application code. DeepSeek orchestration, model-produced SQL, automatic confirmation, and future frontend tool calls are outside this phase.
