-- Synthetic local-demo schema. Dates/times are Asia/Hong_Kong; events are UTC ISO Z.
-- Initialized by db.js inside one BEGIN IMMEDIATE transaction.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  membership_tier TEXT NOT NULL CHECK (membership_tier IN ('first','business','diamond','gold','standard')),
  created_at TEXT NOT NULL CHECK (substr(created_at,-1) = 'Z' AND julianday(created_at) IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS lounges (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 100),
  terminal_area TEXT NOT NULL,
  opening_time TEXT NOT NULL CHECK (opening_time GLOB '[0-2][0-9]:[0-5][0-9]' AND opening_time < '24:00'),
  closing_time TEXT NOT NULL CHECK (closing_time GLOB '[0-2][0-9]:[0-5][0-9]' AND closing_time < '24:00'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  CHECK (opening_time < closing_time)
) STRICT;

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  code TEXT NOT NULL UNIQUE CHECK (code IN ('shower','dining','massage','rest','work')),
  display_name TEXT NOT NULL,
  default_duration_minutes INTEGER NOT NULL CHECK (default_duration_minutes BETWEEN 1 AND 240),
  category TEXT NOT NULL CHECK (category IN ('wellness','dining','rest','work'))
) STRICT;

CREATE TABLE IF NOT EXISTS lounge_services (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  lounge_id INTEGER NOT NULL REFERENCES lounges(id) ON DELETE RESTRICT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  reservation_mode TEXT NOT NULL CHECK (reservation_mode IN ('required','optional','walk_in')),
  eligible_tiers TEXT NOT NULL CHECK (json_valid(eligible_tiers) AND json_type(eligible_tiers) = 'array' AND json_array_length(eligible_tiers) > 0),
  preparation_minutes INTEGER NOT NULL DEFAULT 0 CHECK (preparation_minutes BETWEEN 0 AND 60),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (lounge_id, service_id)
) STRICT;

CREATE TABLE IF NOT EXISTS service_slots (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  lounge_service_id INTEGER NOT NULL REFERENCES lounge_services(id) ON DELETE RESTRICT,
  service_date TEXT NOT NULL CHECK (service_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND date(service_date,'+0 days') IS NOT NULL AND date(service_date,'+0 days') = service_date),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time < '24:00'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time < '24:00'),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  CHECK (start_time < end_time),
  UNIQUE (lounge_service_id, service_date, start_time)
) STRICT;

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  service_slot_id INTEGER NOT NULL REFERENCES service_slots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  created_at TEXT NOT NULL CHECK (substr(created_at,-1) = 'Z' AND julianday(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (substr(updated_at,-1) = 'Z' AND julianday(updated_at) IS NOT NULL AND updated_at >= created_at),
  cancelled_at TEXT CHECK (cancelled_at IS NULL OR (substr(cancelled_at,-1) = 'Z' AND julianday(cancelled_at) IS NOT NULL)),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  operation TEXT NOT NULL DEFAULT 'create' CHECK (operation IN ('create','waitlist','replace')),
  replaces_reservation_id INTEGER REFERENCES reservations(id) ON DELETE RESTRICT,
  waitlist_entry_id INTEGER UNIQUE REFERENCES waitlist_entries(id) ON DELETE RESTRICT,
  CHECK ((operation = 'replace' AND replaces_reservation_id IS NOT NULL) OR (operation <> 'replace' AND replaces_reservation_id IS NULL)),
  CHECK ((operation = 'waitlist' AND waitlist_entry_id IS NOT NULL) OR (operation <> 'waitlist' AND waitlist_entry_id IS NULL)),
  CHECK ((status = 'cancelled' AND cancelled_at IS NOT NULL) OR (status <> 'cancelled' AND cancelled_at IS NULL)),
  UNIQUE (user_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_user_slot
  ON reservations(user_id, service_slot_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS reservations_slot_occupancy ON reservations(service_slot_id, status);
CREATE INDEX IF NOT EXISTS reservations_user_history ON reservations(user_id, id);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  -- Non-reused IDs are the persisted total FIFO order; timestamps can tie.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  service_slot_id INTEGER NOT NULL REFERENCES service_slots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('waiting','offered','accepted','expired','cancelled')),
  offer_expires_at TEXT CHECK (offer_expires_at IS NULL OR (substr(offer_expires_at,-1) = 'Z' AND julianday(offer_expires_at) IS NOT NULL)),
  created_at TEXT NOT NULL CHECK (substr(created_at,-1) = 'Z' AND julianday(created_at) IS NOT NULL),
  reservation_id INTEGER UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
  CHECK (status <> 'waiting' OR offer_expires_at IS NULL),
  CHECK (status <> 'offered' OR offer_expires_at IS NOT NULL),
  CHECK ((status = 'accepted' AND reservation_id IS NOT NULL) OR (status <> 'accepted' AND reservation_id IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_active_user_slot
  ON waitlist_entries(user_id, service_slot_id) WHERE status IN ('waiting','offered');
CREATE INDEX IF NOT EXISTS waitlist_slot_fifo ON waitlist_entries(service_slot_id, status, id);
CREATE INDEX IF NOT EXISTS waitlist_offer_expiry ON waitlist_entries(status, offer_expires_at);
CREATE INDEX IF NOT EXISTS waitlist_user_history ON waitlist_entries(user_id, id);

CREATE TABLE IF NOT EXISTS reservation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE RESTRICT,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 80),
  event_payload TEXT NOT NULL CHECK (json_valid(event_payload) AND json_type(event_payload) = 'object'),
  created_at TEXT NOT NULL CHECK (substr(created_at,-1) = 'Z' AND julianday(created_at) IS NOT NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS events_reservation_history ON reservation_events(reservation_id, id);
CREATE INDEX IF NOT EXISTS events_user_history ON reservation_events(user_id, id);

CREATE TRIGGER IF NOT EXISTS lounge_tiers_insert BEFORE INSERT ON lounge_services
WHEN EXISTS (SELECT 1 FROM json_each(NEW.eligible_tiers) WHERE type <> 'text' OR value NOT IN ('first','business','diamond','gold','standard'))
BEGIN SELECT RAISE(ABORT, 'invalid demo eligibility tiers'); END;
CREATE TRIGGER IF NOT EXISTS lounge_tiers_update BEFORE UPDATE OF eligible_tiers ON lounge_services
WHEN EXISTS (SELECT 1 FROM json_each(NEW.eligible_tiers) WHERE type <> 'text' OR value NOT IN ('first','business','diamond','gold','standard'))
BEGIN SELECT RAISE(ABORT, 'invalid demo eligibility tiers'); END;

CREATE TRIGGER IF NOT EXISTS slot_mode_insert BEFORE INSERT ON service_slots
WHEN (SELECT reservation_mode FROM lounge_services WHERE id = NEW.lounge_service_id) = 'walk_in'
BEGIN SELECT RAISE(ABORT, 'walk-in services have no reservable slots'); END;
CREATE TRIGGER IF NOT EXISTS slot_mode_update BEFORE UPDATE OF lounge_service_id ON service_slots
WHEN (SELECT reservation_mode FROM lounge_services WHERE id = NEW.lounge_service_id) = 'walk_in'
BEGIN SELECT RAISE(ABORT, 'walk-in services have no reservable slots'); END;
CREATE TRIGGER IF NOT EXISTS mode_with_inventory_update BEFORE UPDATE OF reservation_mode ON lounge_services
WHEN NEW.reservation_mode = 'walk_in' AND EXISTS (SELECT 1 FROM service_slots WHERE lounge_service_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'remove inventory before changing a service to walk-in'); END;

CREATE TRIGGER IF NOT EXISTS reservation_identity_immutable BEFORE UPDATE ON reservations
WHEN NEW.user_id <> OLD.user_id OR NEW.service_slot_id <> OLD.service_slot_id OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at OR NEW.waitlist_entry_id IS NOT OLD.waitlist_entry_id OR NEW.operation <> OLD.operation OR NEW.replaces_reservation_id IS NOT OLD.replaces_reservation_id
BEGIN SELECT RAISE(ABORT, 'reservation identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS reservation_terminal_immutable BEFORE UPDATE OF status ON reservations
WHEN OLD.status <> 'confirmed' AND NEW.status <> OLD.status
BEGIN SELECT RAISE(ABORT, 'terminal reservation cannot transition'); END;

-- Holds count conservatively until the service expires them transactionally.
-- An acceptance consumes its own hold and cannot take another passenger's hold.
CREATE TRIGGER IF NOT EXISTS reservation_inventory_insert BEFORE INSERT ON reservations
WHEN NEW.status <> 'cancelled'
BEGIN
  SELECT CASE WHEN NEW.waitlist_entry_id IS NULL AND EXISTS (
    SELECT 1 FROM waitlist_entries WHERE user_id = NEW.user_id AND service_slot_id = NEW.service_slot_id AND status = 'offered'
  ) THEN RAISE(ABORT, 'accept the outstanding waitlist hold instead') END;
  SELECT CASE WHEN NEW.waitlist_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM waitlist_entries WHERE id = NEW.waitlist_entry_id AND user_id = NEW.user_id
      AND service_slot_id = NEW.service_slot_id AND status = 'offered'
  ) THEN RAISE(ABORT, 'reservation does not own this offered hold') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM reservations WHERE service_slot_id = NEW.service_slot_id AND status <> 'cancelled') +
    (SELECT count(*) FROM waitlist_entries WHERE service_slot_id = NEW.service_slot_id AND status = 'offered' AND id IS NOT NEW.waitlist_entry_id)
    >= (SELECT capacity FROM service_slots WHERE id = NEW.service_slot_id)
  THEN RAISE(ABORT, 'reservation capacity exhausted') END;
END;

CREATE TRIGGER IF NOT EXISTS waitlist_identity_immutable BEFORE UPDATE ON waitlist_entries
WHEN NEW.user_id <> OLD.user_id OR NEW.service_slot_id <> OLD.service_slot_id OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'waitlist identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS waitlist_transition BEFORE UPDATE OF status ON waitlist_entries
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'waiting' AND NEW.status IN ('offered','cancelled')) OR
  (OLD.status = 'offered' AND NEW.status IN ('accepted','expired','cancelled'))
)
BEGIN SELECT RAISE(ABORT, 'invalid waitlist transition'); END;
CREATE TRIGGER IF NOT EXISTS waitlist_hold_insert BEFORE INSERT ON waitlist_entries
WHEN NEW.status = 'offered'
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM reservations WHERE service_slot_id = NEW.service_slot_id AND status <> 'cancelled') +
    (SELECT count(*) FROM waitlist_entries WHERE service_slot_id = NEW.service_slot_id AND status = 'offered')
    >= (SELECT capacity FROM service_slots WHERE id = NEW.service_slot_id)
  THEN RAISE(ABORT, 'waitlist hold capacity exhausted') END;
END;
CREATE TRIGGER IF NOT EXISTS waitlist_hold_update BEFORE UPDATE ON waitlist_entries
WHEN NEW.status = 'offered'
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM reservations WHERE service_slot_id = NEW.service_slot_id AND status <> 'cancelled') +
    (SELECT count(*) FROM waitlist_entries WHERE service_slot_id = NEW.service_slot_id AND status = 'offered' AND id <> OLD.id)
    >= (SELECT capacity FROM service_slots WHERE id = NEW.service_slot_id)
  THEN RAISE(ABORT, 'waitlist hold capacity exhausted') END;
END;
CREATE TRIGGER IF NOT EXISTS capacity_floor BEFORE UPDATE OF capacity ON service_slots
WHEN NEW.capacity <
  (SELECT count(*) FROM reservations WHERE service_slot_id = OLD.id AND status <> 'cancelled') +
  (SELECT count(*) FROM waitlist_entries WHERE service_slot_id = OLD.id AND status = 'offered')
BEGIN SELECT RAISE(ABORT, 'capacity cannot be below occupied and held seats'); END;

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON reservation_events
BEGIN SELECT RAISE(ABORT, 'reservation events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON reservation_events
BEGIN SELECT RAISE(ABORT, 'reservation events are append-only'); END;
