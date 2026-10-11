'use strict';

// Each request runs in its own process and SQLite connection. The IPC barrier
// makes the parent release competing requests after both workers are ready.
if (require.main === module && process.send && process.argv[2]) {
  const { openDatabase } = require('../../backend/db.js');
  const { createReservationService } = require('../../backend/reservation-service.js');
  const request = JSON.parse(process.argv[2]);
  let db;

  function finish(result) {
    if (db) db.close();
    process.send({ type: 'result', ...result }, () => process.disconnect());
  }

  try {
    db = openDatabase({ filename: request.filename });
    const service = createReservationService({
      db,
      clock: () => new Date(request.now),
    });
    process.once('message', (message) => {
      if (message.type !== 'go') {
        finish({ ok: false, fatal: true, message: 'Expected the race start signal.' });
        return;
      }
      try {
        const reservation = request.action === 'accept'
          ? service.acceptWaitlistOffer(request.entryId, request.userId)
          : service.createReservation(request.userId, request.slotId, request.key);
        finish({ ok: true, reservation });
      } catch (error) {
        finish({ ok: false, code: error.code, status: error.status, message: error.message });
      }
    });
    process.send({ type: 'ready' });
  } catch (error) {
    finish({ ok: false, fatal: true, code: error.code, message: error.message });
  }
}
