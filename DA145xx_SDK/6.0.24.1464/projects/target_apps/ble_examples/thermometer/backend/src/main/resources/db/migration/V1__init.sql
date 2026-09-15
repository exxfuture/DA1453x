-- Architecture v3 §8/§10 schema. Requires the timescaledb extension to be
-- available in the target Postgres image (see ../../../docker-compose.yml,
-- which uses timescale/timescaledb:latest-pg16).
--
-- This is the schema *baseline* and is now immutable: the local compose stack
-- holds real data (readings accumulate in the postgres_data volume), so schema
-- changes go in a new V<n>__….sql file and existing databases migrate in place.
-- Do not edit this script — Flyway checksums it, and an edit makes every
-- already-migrated database fail validation on the next start. See
-- backend/README.md "Data model".
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Local user registry, JIT-provisioned/re-synced from Keycloak JWT claims on
-- every request (CurrentUserService) — not a Keycloak Admin API sync. No FK
-- from devices.owner_user_id / consent_links.*_user_id / alert_thresholds.*
-- to users.id: kept as loosely-coupled strings, since a device or user can be
-- referenced (e.g. rollout_targets.device_id) before it's provisioned.
CREATE TABLE users (
    id           VARCHAR(64) PRIMARY KEY,
    username     VARCHAR(128) NOT NULL UNIQUE,
    email        VARCHAR(256),
    role         VARCHAR(16) NOT NULL CHECK (role IN ('customer', 'doctor', 'admin')),
    display_name VARCHAR(128),
    temperature_unit VARCHAR(10) NOT NULL DEFAULT 'CELSIUS' CHECK (temperature_unit IN ('CELSIUS', 'FAHRENHEIT')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A device has exactly one owner at a time (owner_user_id is a single column
-- on a single device row), but a customer may own multiple devices — no
-- unique-per-owner constraint here on purpose.
CREATE TABLE devices (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bd_addr        VARCHAR(17) NOT NULL UNIQUE,
    model          VARCHAR(64) NOT NULL,
    fw_version     VARCHAR(32),
    owner_user_id  VARCHAR(64),
    claimed_at     TIMESTAMPTZ,
    -- Denormalised "when did this device last report, and what did it
    -- report", written by MeasurementIngestService on every accepted
    -- reading. Without it, every staleness/health view would need one
    -- ORDER BY ts DESC LIMIT 1 against the measurements hypertable per
    -- device — an N-device fan-out on a page that only ever wants a single
    -- timestamp per row.
    last_seen_at   TIMESTAMPTZ,
    last_seen_type VARCHAR(32),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- devices.owner_user_id is read on nearly every consent/device path
-- (DeviceController.list, ConsentController.myPatients/myPatientsSummary,
-- MeasurementController's access check). Partial (owner_user_id IS NOT NULL)
-- because unclaimed devices are never looked up by owner; findByOwnerUserIdIsNull
-- is a full scan of a small table either way.
CREATE INDEX idx_devices_owner ON devices (owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE measurement_types (
    key         VARCHAR(32) PRIMARY KEY,
    unit        VARCHAR(32) NOT NULL,
    json_schema JSONB,
    version     INT NOT NULL DEFAULT 1
);
INSERT INTO measurement_types (key, unit) VALUES
    ('temperature', 'celsius'),
    ('humidity', 'relative_humidity_pct'),
    ('battery', 'percent');

-- Dedup key is (device_id, type, ts): MQTT QoS 1 redelivery or a retried
-- REST upload is a no-op, never a duplicate row (architecture v3 §8).
CREATE TABLE measurements (
    ts           TIMESTAMPTZ NOT NULL,
    device_id    VARCHAR(17) NOT NULL,
    type         VARCHAR(32) NOT NULL,
    value_num    DOUBLE PRECISION,
    payload      JSONB NOT NULL,
    collector_id VARCHAR(128),
    PRIMARY KEY (device_id, type, ts)
);
SELECT create_hypertable('measurements', 'ts', if_not_exists => TRUE);
SELECT add_retention_policy('measurements', INTERVAL '2 years', if_not_exists => TRUE);

CREATE INDEX idx_measurements_device_type_ts ON measurements (device_id, type, ts DESC);

-- FR-4: consent-based doctor <-> patient linking. Scope/revocation are data,
-- not configuration — enforcement reads this table directly.
CREATE TABLE consent_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_user_id VARCHAR(64) NOT NULL,
    doctor_user_id  VARCHAR(64) NOT NULL,
    scope           JSONB,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX idx_consent_links_doctor ON consent_links (doctor_user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_consent_links_patient ON consent_links (patient_user_id) WHERE revoked_at IS NULL;

-- Configurable temperature-tier boundaries. One table, three scopes, resolved
-- most-specific-first by AlertThresholdService: a doctor's per-patient
-- override beats the patient's own setting, which beats the system default,
-- which falls back to AlertThresholdService.FALLBACK if no row exists at
-- all. Precedence is whole-row, not per-field: a row is a complete scale, so
-- a partially-filled override can never produce a non-monotonic mix of two
-- sources.
--
-- Each column is named after the tier it turns ON at, not the tier below it
-- — normal_start_c is the temperature at/above which a reading is tagged
-- Normal (and no longer Low), and so on up to high_fever_start_c. There is
-- no column for "low": it's the implicit floor tier, everything below
-- normal_start_c.
--
-- set_by_user_id is who wrote the row (audit + the doctor_override key);
-- subject_user_id is whose readings it applies to, NULL only for the single
-- system row.
CREATE TABLE alert_thresholds (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope              VARCHAR(16) NOT NULL CHECK (scope IN ('system', 'self', 'doctor_override')),
    subject_user_id    VARCHAR(64),
    set_by_user_id     VARCHAR(64) NOT NULL,
    normal_start_c     DOUBLE PRECISION NOT NULL,
    elevated_start_c   DOUBLE PRECISION NOT NULL,
    fever_start_c      DOUBLE PRECISION NOT NULL,
    high_fever_start_c DOUBLE PRECISION NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A scale that isn't strictly increasing would make some tier
    -- unreachable; rejected at the DB so no API path can persist one.
    CONSTRAINT ck_alert_thresholds_monotonic
        CHECK (normal_start_c < elevated_start_c AND elevated_start_c < fever_start_c AND fever_start_c < high_fever_start_c),
    -- Exactly the system scope is subject-less, and only it.
    CONSTRAINT ck_alert_thresholds_subject_scope
        CHECK ((scope = 'system') = (subject_user_id IS NULL))
);

-- Upsert keys, one per scope: a single system row; at most one self row per
-- user; at most one override per (patient, doctor) pair.
CREATE UNIQUE INDEX ux_alert_thresholds_system ON alert_thresholds ((scope)) WHERE scope = 'system';
CREATE UNIQUE INDEX ux_alert_thresholds_self ON alert_thresholds (subject_user_id) WHERE scope = 'self';
CREATE UNIQUE INDEX ux_alert_thresholds_doctor_override
    ON alert_thresholds (subject_user_id, set_by_user_id) WHERE scope = 'doctor_override';

-- Customer-authored notes attached to a point in time ("took ibuprofen",
-- "thermometer fell off") or to a span (ts_to set). Deliberately not a
-- foreign key to measurements: a note may sit between readings, and
-- measurements is a hypertable under a 2-year retention policy — an FK would
-- either block retention drops or cascade user-written text away with them.
CREATE TABLE measurement_annotations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    VARCHAR(64) NOT NULL,
    device_id  VARCHAR(17) NOT NULL,
    ts_from    TIMESTAMPTZ NOT NULL,
    ts_to      TIMESTAMPTZ,
    note       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_measurement_annotations_range CHECK (ts_to IS NULL OR ts_to >= ts_from)
);

-- Chart overlay: "all notes for this device in this window", newest first.
CREATE INDEX idx_measurement_annotations_device_ts ON measurement_annotations (device_id, ts_from DESC);
-- Ownership checks and the author's own list.
CREATE INDEX idx_measurement_annotations_user ON measurement_annotations (user_id);

-- A doctor's clinical notes about a patient. Doctor-private by design: this
-- system's consent only ever flows patient -> doctor (see consent_links and
-- FR-4), so there is no patient-facing read path for these; admin gets a
-- read-only compliance view.
CREATE TABLE care_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_user_id  VARCHAR(64) NOT NULL,
    patient_user_id VARCHAR(64) NOT NULL,
    note            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only hot read: one doctor's notes on one patient, newest first.
CREATE INDEX idx_care_notes_doctor_patient
    ON care_notes (doctor_user_id, patient_user_id, created_at DESC);

-- FR-6/architecture v3 §10: DIY rollout orchestration, no hawkBit dependency
-- until the trigger condition in ARCHITECTURE_V3.html §15 is actually hit.
CREATE TABLE rollouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version             VARCHAR(32) NOT NULL,
    chip_model          VARCHAR(32) NOT NULL,
    image_url           VARCHAR(512) NOT NULL,
    delta_url           VARCHAR(512),
    sha256              VARCHAR(64) NOT NULL,
    signature           VARCHAR(512) NOT NULL,
    group_percentage    INT NOT NULL DEFAULT 100,
    abort_threshold_pct INT NOT NULL DEFAULT 20,
    status              VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- device_id here is the BD address, not devices.id — a device can report OTA
-- status before it has ever been claimed by a customer.
CREATE TABLE rollout_targets (
    rollout_id   UUID NOT NULL REFERENCES rollouts(id),
    device_id    VARCHAR(17) NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'pending',
    reported_at  TIMESTAMPTZ,
    error_detail TEXT,
    PRIMARY KEY (rollout_id, device_id)
);

CREATE TABLE audit_log (
    id       BIGSERIAL PRIMARY KEY,
    actor_id VARCHAR(64),
    action   VARCHAR(64) NOT NULL,
    subject  VARCHAR(128),
    detail   JSONB,
    at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
