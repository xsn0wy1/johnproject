-- Shared catalogs reused by later hospital management; no demonstration records.
ALTER TABLE facilities ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE facilities ADD COLUMN latitude DECIMAL(10,7) NULL;
ALTER TABLE facilities ADD COLUMN longitude DECIMAL(10,7) NULL;
ALTER TABLE patients ADD COLUMN date_of_birth DATE NULL;
ALTER TABLE patients ADD COLUMN sex VARCHAR(16) NULL;

CREATE TABLE IF NOT EXISTS staff_roles (
    staff_id BIGINT UNSIGNED NOT NULL,
    role_code VARCHAR(16) NOT NULL,
    PRIMARY KEY (staff_id, role_code),
    CONSTRAINT fk_staff_responsibility FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ambulances (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    plate VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT '',
    capacity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    operational_status VARCHAR(20) NOT NULL DEFAULT 'available',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ambulance_code (code),
    UNIQUE KEY uq_ambulance_plate (plate)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_templates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(150) NOT NULL,
    origin_facility_id BIGINT UNSIGNED NOT NULL,
    destination_facility_id BIGINT UNSIGNED NOT NULL,
    geometry LONGTEXT NOT NULL,
    distance_meters INT UNSIGNED NOT NULL,
    duration_seconds INT UNSIGNED NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uq_route_code (code),
    KEY ix_route_endpoints (origin_facility_id, destination_facility_id, status),
    CONSTRAINT fk_route_origin FOREIGN KEY (origin_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_route_destination FOREIGN KEY (destination_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_stops (
    route_id BIGINT UNSIGNED NOT NULL,
    stop_number SMALLINT UNSIGNED NOT NULL,
    facility_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (route_id, stop_number),
    CONSTRAINT fk_stop_route FOREIGN KEY (route_id) REFERENCES route_templates(id) ON DELETE RESTRICT,
    CONSTRAINT fk_stop_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_by BIGINT UNSIGNED NOT NULL,
    ambulance_id BIGINT UNSIGNED NOT NULL,
    patient_id BIGINT UNSIGNED NULL,
    route_template_id BIGINT UNSIGNED NOT NULL,
    origin_facility_id BIGINT UNSIGNED NOT NULL,
    destination_facility_id BIGINT UNSIGNED NOT NULL,
    ambulance_code VARCHAR(20) NOT NULL,
    ambulance_plate VARCHAR(20) NOT NULL,
    origin_name VARCHAR(150) NOT NULL,
    destination_name VARCHAR(150) NOT NULL,
    origin_address VARCHAR(255) NOT NULL,
    destination_address VARCHAR(255) NOT NULL,
    geometry LONGTEXT NOT NULL,
    distance_meters INT UNSIGNED NOT NULL,
    duration_seconds INT UNSIGNED NOT NULL,
    cargo_type VARCHAR(16) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    reason VARCHAR(20) NOT NULL,
    notes VARCHAR(1000) NOT NULL DEFAULT '',
    special_equipment TINYINT(1) NOT NULL DEFAULT 0,
    with_family TINYINT(1) NOT NULL DEFAULT 0,
    interdepartmental TINYINT(1) NOT NULL DEFAULT 0,
    critical_patient TINYINT(1) NOT NULL DEFAULT 0,
    scheduled_at DATETIME NOT NULL,
    reserved_until DATETIME NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    started_at DATETIME NULL,
    arrived_at DATETIME NULL,
    finished_at DATETIME NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    create_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    create_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_transfer_create (created_by, create_key),
    KEY ix_transfer_status_schedule (status, scheduled_at, id),
    KEY ix_transfer_patient (patient_id, scheduled_at, id),
    CONSTRAINT fk_transfer_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_vehicle FOREIGN KEY (ambulance_id) REFERENCES ambulances(id) ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_route FOREIGN KEY (route_template_id) REFERENCES route_templates(id) ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_origin FOREIGN KEY (origin_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_destination FOREIGN KEY (destination_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_crew (
    transfer_id BIGINT UNSIGNED NOT NULL,
    staff_id BIGINT UNSIGNED NOT NULL,
    duty VARCHAR(16) NOT NULL,
    name_snapshot VARCHAR(150) NOT NULL,
    responsibility VARCHAR(16) NOT NULL,
    PRIMARY KEY (transfer_id, duty),
    UNIQUE KEY uq_transfer_crew_member (transfer_id, staff_id),
    KEY ix_assigned_staff (staff_id, transfer_id),
    CONSTRAINT fk_crew_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_crew_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS resource_reservations (
    transfer_id BIGINT UNSIGNED NOT NULL,
    resource_type VARCHAR(16) NOT NULL,
    resource_id BIGINT UNSIGNED NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    PRIMARY KEY (transfer_id, resource_type, resource_id),
    KEY ix_resource_interval (resource_type, resource_id, starts_at, ends_at),
    CONSTRAINT fk_reservation_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    transfer_id BIGINT UNSIGNED NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(32) NOT NULL,
    from_status VARCHAR(16) NULL,
    to_status VARCHAR(16) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_transfer_events (transfer_id, id),
    CONSTRAINT fk_event_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_drafts (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    payload LONGTEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_draft_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS simulation_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    speed DECIMAL(6,2) NOT NULL DEFAULT 1,
    generation INT UNSIGNED NOT NULL DEFAULT 1,
    heartbeat_at DATETIME NULL,
    last_tick_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT UNSIGNED NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS simulation_state (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    current_run_id BIGINT UNSIGNED NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    CONSTRAINT fk_current_simulation FOREIGN KEY (current_run_id) REFERENCES simulation_runs(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
INSERT IGNORE INTO simulation_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS transfer_positions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    transfer_id BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NULL,
    generation INT UNSIGNED NOT NULL DEFAULT 1,
    progress DECIMAL(10,8) NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(16) NOT NULL DEFAULT 'simulated',
    KEY ix_position_transfer (transfer_id, id),
    KEY ix_position_retention (recorded_at, id),
    CONSTRAINT fk_position_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_position_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfer_latest_positions (
    transfer_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    position_id BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_latest_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_latest_position FOREIGN KEY (position_id) REFERENCES transfer_positions(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
