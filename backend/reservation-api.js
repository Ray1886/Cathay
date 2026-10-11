'use strict';

const MAX_BODY_BYTES = 16 * 1024;

function apiError(code, status, message, details) {
  return Object.assign(new Error(message), { code, status, ...(details === undefined ? {} : { details }) });
}

function positiveId(value, name) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value <= 0) throw apiError('INVALID_INPUT', 400, `${name} must be a positive integer.`);
  return value;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw apiError('INVALID_INPUT', 400, 'date must be a valid YYYY-MM-DD date.');
  }
  return value;
}

function allowedObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw apiError('INVALID_INPUT', 400, 'A JSON object is required.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw apiError('INVALID_INPUT', 400, `Unknown field: ${key}.`);
  return value;
}

function isLoopback(address) {
  return typeof address === 'string' && (address === '::1' || /^(?:::ffff:)?127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address));
}

function loopbackUrl(raw, port, origin = false) {
  try {
    if (typeof raw !== 'string' || (!origin && /[\s/?#\\]/.test(raw))) return false;
    const url = new URL(origin ? raw : `http://${raw}`);
    if (url.protocol !== 'http:' || url.username || url.password || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) return false;
    if (Number(url.port || 80) !== port) return false;
    if (url.pathname !== '/' || url.search || url.hash) return false;
    if (origin && raw.toLowerCase() !== url.origin) return false;
    return true;
  } catch { return false; }
}

function verifyLocalRequest(req) {
  if (!isLoopback(req.socket.remoteAddress)) throw apiError('LOCAL_ONLY', 403, 'This demo API accepts loopback clients only.');
  if (!loopbackUrl(req.headers.host, req.socket.localPort)) throw apiError('INVALID_HOST', 403, 'Host must match this loopback server and port.');
  if (req.headers.origin !== undefined && !loopbackUrl(req.headers.origin, req.socket.localPort, true)) throw apiError('INVALID_ORIGIN', 403, 'Origin must match this loopback server and port.');
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw apiError('UNSUPPORTED_MEDIA_TYPE', 415, 'Content-Type must be application/json.');
  const size = req.headers['content-length'];
  if (size !== undefined && (!/^\d+$/.test(size) || Number(size) > MAX_BODY_BYTES)) throw apiError('PAYLOAD_TOO_LARGE', 413, 'JSON body exceeds 16 KiB.');
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted); };
    const onError = (error) => { cleanup(); reject(error); };
    const onAborted = () => onError(apiError('INVALID_JSON', 400, 'The JSON request was interrupted.'));
    const onData = (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) { cleanup(); req.pause(); reject(apiError('PAYLOAD_TOO_LARGE', 413, 'JSON body exceeds 16 KiB.')); }
      else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAborted);
  });
  try {
    const parsed = JSON.parse(buffer);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw apiError('INVALID_INPUT', 400, 'A JSON object is required.');
    return parsed;
  }
  catch (error) {
    if (error.code === 'INVALID_INPUT') throw error;
    throw apiError('INVALID_JSON', 400, 'The request body must contain valid JSON.');
  }
}

function queryObject(url, allowed) {
  const result = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw apiError('INVALID_INPUT', 400, `Unknown or duplicate query parameter: ${key}.`);
    result[key] = value;
  }
  return result;
}

function identity(req, required = true) {
  const raw = req.headers['x-demo-user-id'];
  if (raw === undefined && !required) return undefined;
  if (raw === undefined) throw apiError('DEMO_IDENTITY_REQUIRED', 401, 'X-Demo-User-Id is required for this local demo operation.');
  return positiveId(raw, 'X-Demo-User-Id');
}

function boundIdentity(supplied, userId) {
  if (supplied !== undefined && positiveId(supplied, 'userId') !== userId) throw apiError('IDENTITY_MISMATCH', 403, 'The requested user must match X-Demo-User-Id.');
}

function requestKey(req, body) {
  const header = req.headers['idempotency-key'];
  if (header !== undefined && body.idempotencyKey !== undefined && header !== body.idempotencyKey) throw apiError('INVALID_INPUT', 400, 'Idempotency keys in the header and body must match.');
  const key = body.idempotencyKey ?? header;
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw apiError('INVALID_INPUT', 400, 'idempotencyKey must contain 1–128 ASCII letters, digits, dots, underscores, colons or hyphens.');
  return key;
}

function bodyId(value, name) {
  if (typeof value !== 'number') throw apiError('INVALID_INPUT', 400, `${name} must be a JSON integer.`);
  return positiveId(value, name);
}

function checkBodyIdentity(body, userId) {
  if (body.userId !== undefined) boundIdentity(bodyId(body.userId, 'userId'), userId);
}

// This handler is deliberately separate from the existing chat server and UI.
function createReservationApi({ service }) {
  if (!service) throw new TypeError('service is required.');
  return async function reservationApi(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return false; }
    const path = url.pathname;
    let route;
    let match;
    if (path === '/api/lounges') route = ['GET', 'lounges'];
    else if ((match = path.match(/^\/api\/lounges\/([^/]+)\/services$/))) route = ['GET', 'services', match[1]];
    else if (path === '/api/services/slots' || path === '/api/slots') route = ['GET', 'slots'];
    else if ((match = path.match(/^\/api\/slots\/([^/]+)\/availability$/))) route = ['GET', 'availability', match[1]];
    else if (path === '/api/reservations') route = ['POST', 'book'];
    else if ((match = path.match(/^\/api\/users\/([^/]+)\/reservations$/))) route = ['GET', 'reservations', match[1]];
    else if ((match = path.match(/^\/api\/reservations\/([^/]+)\/replace$/))) route = ['POST', 'replace', match[1]];
    else if ((match = path.match(/^\/api\/reservations\/([^/]+)$/))) route = ['DELETE', 'cancel', match[1]];
    else if (path === '/api/waitlist') route = ['POST', 'join'];
    else if (path === '/api/waitlist/position') route = ['GET', 'position'];
    else if ((match = path.match(/^\/api\/users\/([^/]+)\/waitlist$/))) route = ['GET', 'waitlist', match[1]];
    else if ((match = path.match(/^\/api\/waitlist\/([^/]+)\/accept$/))) route = ['POST', 'accept', match[1]];
    else if ((match = path.match(/^\/api\/waitlist\/([^/]+)$/))) route = ['DELETE', 'leave', match[1]];
    if (!route) return false;

    let cors = {};
    try {
      verifyLocalRequest(req);
      if (req.headers.origin) cors = { 'Access-Control-Allow-Origin': req.headers.origin, Vary: 'Origin' };
      if (req.method === 'OPTIONS') {
        if (req.headers['access-control-request-method'] !== route[0]) throw apiError('METHOD_NOT_ALLOWED', 405, 'The requested method is not supported.');
        const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
        if (requested.some((name) => !['content-type', 'x-demo-user-id', 'idempotency-key'].includes(name))) throw apiError('INVALID_INPUT', 400, 'The requested headers are not supported.');
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': route[0], 'Access-Control-Allow-Headers': 'Content-Type, X-Demo-User-Id, Idempotency-Key', 'Cache-Control': 'no-store' });
        res.end(); return true;
      }
      if (req.method !== route[0]) throw apiError('METHOD_NOT_ALLOWED', 405, 'This route does not support the requested method.', { allowed: [route[0]] });
      let data;
      let status = 200;
      const action = route[1];
      if (action === 'lounges') { queryObject(url, []); data = service.listLounges(); }
      else if (action === 'services') {
        const query = queryObject(url, ['userId']);
        const userId = identity(req, query.userId !== undefined);
        boundIdentity(query.userId, userId);
        data = service.listServices(positiveId(route[2], 'loungeId'), { userId });
      } else if (action === 'slots') {
        const query = queryObject(url, ['date', 'loungeId', 'serviceCode', 'includeFull', 'userId']);
        const userId = identity(req, query.userId !== undefined);
        boundIdentity(query.userId, userId);
        if (query.includeFull !== undefined && !['true', 'false'].includes(query.includeFull)) throw apiError('INVALID_INPUT', 400, 'includeFull must be true or false.');
        if (query.serviceCode !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/.test(query.serviceCode)) throw apiError('INVALID_INPUT', 400, 'serviceCode must be a service code.');
        data = service.listAvailableSlots({ date: validDate(query.date), ...(query.loungeId === undefined ? {} : { loungeId: positiveId(query.loungeId, 'loungeId') }), serviceCode: query.serviceCode, userId, includeFull: query.includeFull === 'true' });
      } else if (action === 'availability') {
        queryObject(url, []); data = service.getSlotAvailability(positiveId(route[2], 'slotId'));
      } else {
        const userId = identity(req);
        if (action === 'reservations') {
          const query = queryObject(url, ['status']);
          boundIdentity(route[2], userId);
          if (query.status !== undefined && !['confirmed', 'cancelled', 'completed', 'no_show'].includes(query.status)) throw apiError('INVALID_INPUT', 400, 'status must be a reservation status.');
          data = service.getUserReservations(userId, { status: query.status });
        } else if (action === 'waitlist') {
          queryObject(url, []); boundIdentity(route[2], userId); data = service.getUserWaitlist(userId);
        } else if (action === 'position') {
          const query = queryObject(url, ['slotId', 'userId']); boundIdentity(query.userId, userId);
          data = service.getWaitlistPosition(userId, positiveId(query.slotId, 'slotId'));
        } else if (action === 'cancel' || action === 'leave') {
          queryObject(url, []);
          if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0) {
            const body = allowedObject(await readBody(req), ['userId']); checkBodyIdentity(body, userId);
          }
          const id = positiveId(route[2], action === 'cancel' ? 'reservationId' : 'entryId');
          data = action === 'cancel' ? service.cancelReservation(id, userId) : service.cancelWaitlistEntry(id, userId);
        } else {
          queryObject(url, []);
          const body = await readBody(req);
          const fields = action === 'book' ? ['slotId', 'idempotencyKey', 'userId'] : action === 'replace' ? ['newSlotId', 'idempotencyKey', 'userId'] : action === 'join' ? ['slotId', 'userId'] : ['userId'];
          allowedObject(body, fields); checkBodyIdentity(body, userId);
          if (action === 'book') {
            data = service.createReservation(userId, bodyId(body.slotId, 'slotId'), requestKey(req, body)); status = data.replayed ? 200 : 201;
          } else if (action === 'replace') data = service.replaceReservation(positiveId(route[2], 'reservationId'), userId, bodyId(body.newSlotId, 'newSlotId'), requestKey(req, body));
          else if (action === 'join') { data = service.joinWaitlist(userId, bodyId(body.slotId, 'slotId')); status = 201; }
          else data = service.acceptWaitlistOffer(positiveId(route[2], 'entryId'), userId);
        }
      }
      send(res, status, { data }, cors);
    } catch (error) {
      const known = typeof error.code === 'string' && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599;
      const status = known ? error.status : 500;
      const headers = { ...cors, ...(status === 405 ? { Allow: route[0] } : {}), ...([413, 415].includes(status) ? { Connection: 'close' } : {}) };
      send(res, status, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'The reservation request could not be completed.', ...(known && error.details !== undefined ? { details: error.details } : {}) } }, headers);
    }
    return true;
  };
}

module.exports = { createReservationApi, MAX_BODY_BYTES };
