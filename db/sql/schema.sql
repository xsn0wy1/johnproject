-- Hospital user system, schema versions 001–012. MySQL 5.7+/MariaDB 10.4 compatible.
-- Fresh installation: import this file with an administrative SQL account.
-- Run the PHP setup/migration commands for upgrades. Future changes belong in numbered db/sql/migrations files.
CREATE DATABASE IF NOT EXISTS hospital CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hospital;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    national_id VARCHAR(20) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_staff_national_id (national_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    staff_id BIGINT UNSIGNED NULL,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(254) NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    registration_national_id VARCHAR(20) NOT NULL,
    email_verified_at DATETIME NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    auth_version INT UNSIGNED NOT NULL DEFAULT 1,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_registration_national_id (registration_national_id),
    UNIQUE KEY uq_users_staff (staff_id),
    KEY ix_users_status_id (status, id),
    CONSTRAINT fk_users_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
    CONSTRAINT fk_users_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(40) NOT NULL,
    label VARCHAR(80) NOT NULL,
    UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT UNSIGNED NOT NULL,
    role_id SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Extend an existing identity database without replacing account data.
CREATE TABLE IF NOT EXISTS facilities (
    locality VARCHAR(80) NOT NULL DEFAULT '',
    facility_type VARCHAR(20) NOT NULL DEFAULT 'other',
    phone VARCHAR(25) NOT NULL DEFAULT '',
    notes VARCHAR(400) NOT NULL DEFAULT '',
    availability VARCHAR(16) NOT NULL DEFAULT 'active',
    archived_at DATETIME NULL,
    address VARCHAR(255) NOT NULL DEFAULT '',
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_facility_identity (name,address,locality)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS specialties (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    UNIQUE KEY uq_specialty_name (name)
) ENGINE=InnoDB;

-- Self-declared profile information; never grants qualifications or permissions.
CREATE TABLE IF NOT EXISTS staff_specialties (
    staff_id BIGINT UNSIGNED NOT NULL,
    specialty_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (staff_id, specialty_id),
    CONSTRAINT fk_staff_specialty_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
    CONSTRAINT fk_staff_specialty_catalog FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stored_files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_user_id BIGINT UNSIGNED NOT NULL,
    storage_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    byte_size INT UNSIGNED NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'ready',
    purpose VARCHAR(16) NOT NULL DEFAULT 'avatar',
    scan_status VARCHAR(32) NOT NULL DEFAULT 'image_normalized',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_file_storage_key (storage_key),
    CONSTRAINT fk_file_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS user_settings (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    locale VARCHAR(10) NOT NULL DEFAULT 'es-UY',
    theme VARCHAR(10) NOT NULL DEFAULT 'dark',
    photo_visible_to_staff TINYINT(1) NOT NULL DEFAULT 0,
    optional_diagnostics TINYINT(1) NOT NULL DEFAULT 0,
    security_notifications TINYINT(1) NOT NULL DEFAULT 1,
    automatic_logout TINYINT(1) NOT NULL DEFAULT 1,
    default_facility_id BIGINT UNSIGNED NULL,
    avatar_file_id BIGINT UNSIGNED NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_settings_facility FOREIGN KEY (default_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_settings_avatar FOREIGN KEY (avatar_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
    CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Used directly by the PHP session handler, including anonymous CSRF sessions.
-- Raw cookie IDs are never stored: session_hash is SHA-256(session_id).
CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    payload MEDIUMBLOB NOT NULL,
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    absolute_expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    UNIQUE KEY uq_session_hash (session_hash),
    KEY ix_sessions_user_live (user_id, revoked_at, expires_at),
    KEY ix_sessions_expiry (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    attempts INT UNSIGNED NOT NULL,
    resets_at DATETIME NOT NULL,
    KEY ix_rate_limits_expiry (resets_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_user_id BIGINT UNSIGNED NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(40) NOT NULL,
    resource_id BIGINT UNSIGNED NULL,
    request_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_audit_resource (resource_type, resource_id, created_at),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO roles (code, label) VALUES
    ('admin', 'Administrador'), ('records_manager', 'Gestor de registros'),
    ('dispatcher', 'Coordinador de traslados'), ('staff', 'Funcionario')
ON DUPLICATE KEY UPDATE label = VALUES(label);
-- PHP setup/migrate verifies the 002 structures below and records 002_settings.
INSERT IGNORE INTO schema_migrations (version) VALUES ('001_user_system');

CREATE TABLE IF NOT EXISTS user_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    kind VARCHAR(40) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME NULL,
    KEY ix_notifications_user (user_id, id),
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Opt-in aggregate only: no URLs, IP addresses, event contents or session IDs.
CREATE TABLE IF NOT EXISTS user_diagnostics (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    sample_count INT UNSIGNED NOT NULL DEFAULT 0,
    total_load_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_recorded_at DATETIME NOT NULL,
    CONSTRAINT fk_diagnostics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Minimal shared patient identities. Hospital management owns this catalog;
-- document upload must never create patients from arbitrary text.
CREATE TABLE IF NOT EXISTS patients (
    date_of_birth DATE NULL,
    sex VARCHAR(16) NULL,
    estimated_age SMALLINT UNSIGNED NULL,
    age_recorded_on DATE NULL,
    phone VARCHAR(25) NOT NULL DEFAULT '',
    blood_group VARCHAR(3) NULL,
    allergies VARCHAR(100) NOT NULL DEFAULT '',
    archived_at DATETIME NULL,
    create_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    create_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    national_id VARCHAR(20) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_patient_create_key (create_key),
    UNIQUE KEY uq_patient_national_id (national_id),
    KEY ix_patient_status_name (status, full_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_categories (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(100) NOT NULL,
    requires_patient TINYINT(1) NOT NULL,
    UNIQUE KEY uq_document_category_code (code)
) ENGINE=InnoDB;

INSERT INTO document_categories (code, name, requires_patient) VALUES
    ('medical_report', 'Informe Médico', 1),
    ('laboratory_study', 'Estudio de Laboratorio', 1),
    ('administrative', 'Documento Administrativo', 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), requires_patient = VALUES(requires_patient);


CREATE TABLE IF NOT EXISTS documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uploader_user_id BIGINT UNSIGNED NOT NULL,
    patient_id BIGINT UNSIGNED NULL,
    category_id SMALLINT UNSIGNED NOT NULL,
    title VARCHAR(150) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    document_date DATE NOT NULL,
    current_file_version INT UNSIGNED NOT NULL DEFAULT 1,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    create_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    create_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_document_create (uploader_user_id, create_key),
    KEY ix_document_owner_archive (uploader_user_id, archived_at, id),
    KEY ix_document_patient_date (patient_id, created_at, id),
    KEY ix_document_archive_date (archived_at, created_at, id),
    CONSTRAINT fk_document_uploader FOREIGN KEY (uploader_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_category FOREIGN KEY (category_id) REFERENCES document_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Immutable binaries: replacements append a version, never overwrite old bytes.
CREATE TABLE IF NOT EXISTS document_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    stored_file_id BIGINT UNSIGNED NOT NULL,
    uploaded_by BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    extension VARCHAR(8) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_document_file_version (document_id, version_number),
    UNIQUE KEY uq_document_stored_file (stored_file_id),
    CONSTRAINT fk_document_version_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_version_file FOREIGN KEY (stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_version_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Shared catalogs reused by later hospital management; no demonstration records.






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
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ambulance_code (code),
    UNIQUE KEY uq_ambulance_plate (plate)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_templates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(150) NOT NULL,
    origin_facility_id BIGINT UNSIGNED NULL,
    destination_facility_id BIGINT UNSIGNED NULL,
    geometry LONGTEXT NOT NULL,
    distance_meters INT UNSIGNED NOT NULL,
    duration_seconds INT UNSIGNED NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    origin_name VARCHAR(150) NOT NULL DEFAULT '',
    origin_address VARCHAR(255) NOT NULL DEFAULT '',
    destination_name VARCHAR(150) NOT NULL DEFAULT '',
    destination_address VARCHAR(255) NOT NULL DEFAULT '',
    category VARCHAR(24) NOT NULL DEFAULT 'interhospital',
    direction VARCHAR(16) NOT NULL DEFAULT 'one_way',
    availability VARCHAR(16) NOT NULL DEFAULT 'active',
    notes VARCHAR(500) NOT NULL DEFAULT '',
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_route_code (code),
    KEY ix_route_endpoints (origin_facility_id, destination_facility_id, status),
    CONSTRAINT fk_route_origin FOREIGN KEY (origin_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_route_destination FOREIGN KEY (destination_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_stops (
    route_id BIGINT UNSIGNED NOT NULL,
    stop_number SMALLINT UNSIGNED NOT NULL,
    facility_id BIGINT UNSIGNED NULL,
    name VARCHAR(150) NOT NULL DEFAULT '',
    address VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (route_id, stop_number),
    CONSTRAINT fk_stop_route FOREIGN KEY (route_id) REFERENCES route_templates(id) ON DELETE RESTRICT,
    CONSTRAINT fk_stop_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_by BIGINT UNSIGNED NOT NULL,
    ambulance_id BIGINT UNSIGNED NOT NULL,
    patient_id BIGINT UNSIGNED NULL,
    route_template_id BIGINT UNSIGNED NULL,
    origin_facility_id BIGINT UNSIGNED NULL,
    destination_facility_id BIGINT UNSIGNED NULL,
    ambulance_code VARCHAR(20) NOT NULL,
    ambulance_plate VARCHAR(20) NOT NULL,
    origin_name VARCHAR(150) NOT NULL,
    destination_name VARCHAR(150) NOT NULL,
    origin_address VARCHAR(255) NOT NULL,
    destination_address VARCHAR(255) NOT NULL,
    geometry LONGTEXT NOT NULL,
    distance_meters INT UNSIGNED NULL,
    duration_seconds INT UNSIGNED NULL,
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
    route_snapshot LONGTEXT NULL,
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

CREATE TABLE IF NOT EXISTS departments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uq_department_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patient_contacts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT UNSIGNED NOT NULL,
    full_name VARCHAR(100) NOT NULL DEFAULT '',
    phone VARCHAR(25) NOT NULL DEFAULT '',
    relationship VARCHAR(50) NOT NULL DEFAULT '',
    UNIQUE KEY uq_patient_emergency (patient_id),
    CONSTRAINT fk_contact_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Latest ID is the current encounter; starting care after discharge appends one.
-- Patient-row locks serialize encounter selection/creation. Older cases remain.
CREATE TABLE IF NOT EXISTS patient_encounters (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT UNSIGNED NOT NULL,
    care_status VARCHAR(16) NOT NULL,
    room VARCHAR(80) NOT NULL DEFAULT '',
    department_id BIGINT UNSIGNED NULL,
    doctor_staff_id BIGINT UNSIGNED NULL,
    doctor_specialty VARCHAR(80) NOT NULL DEFAULT '',
    admission_date DATE NULL,
    discharged_at DATETIME NULL,
    diagnosis VARCHAR(1000) NOT NULL DEFAULT '',
    clinical_state VARCHAR(100) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_encounter_patient (patient_id, id),
    KEY ix_encounter_discharge (discharged_at, patient_id),
    CONSTRAINT fk_encounter_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
    CONSTRAINT fk_encounter_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_encounter_doctor FOREIGN KEY (doctor_staff_id) REFERENCES staff(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Scheduling UI is a later slice; this is the shared source of the existing count.
CREATE TABLE IF NOT EXISTS patient_appointments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    patient_id BIGINT UNSIGNED NOT NULL,
    scheduled_at DATETIME NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    KEY ix_appointment_day (status, scheduled_at),
    CONSTRAINT fk_appointment_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Clinical doctor records share staff identities; they do not create login accounts.
CREATE TABLE IF NOT EXISTS doctor_profiles (
    staff_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    title VARCHAR(8) NOT NULL,
    license VARCHAR(30) NOT NULL,
    specialty_id BIGINT UNSIGNED NOT NULL,
    department_id BIGINT UNSIGNED NOT NULL,
    office VARCHAR(80) NOT NULL DEFAULT '',
    phone VARCHAR(25) NOT NULL,
    email VARCHAR(120) NOT NULL DEFAULT '',
    availability VARCHAR(16) NOT NULL DEFAULT 'available',
    shift VARCHAR(16) NOT NULL DEFAULT 'morning',
    days VARCHAR(40) NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    notes VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_doctor_license (license),
    CONSTRAINT fk_doctor_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
    CONSTRAINT fk_doctor_specialty FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT,
    CONSTRAINT fk_doctor_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Operational crew profiles share staff identities with accounts and doctors.
CREATE TABLE IF NOT EXISTS personnel_profiles (
    staff_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    responsibility VARCHAR(16) NOT NULL,
    driving_license VARCHAR(30) NULL,
    availability VARCHAR(16) NOT NULL DEFAULT 'active',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_personnel_license (driving_license),
    CONSTRAINT fk_personnel_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_map_cache (
    cache_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    payload LONGTEXT NOT NULL,
    expires_at DATETIME NOT NULL
) ENGINE=InnoDB;

-- Staff-authored surveys; links are bearer invitations, never patient identities.
CREATE TABLE IF NOT EXISTS surveys (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(24) NOT NULL,
    area VARCHAR(100) NOT NULL DEFAULT '',
    notes TEXT NOT NULL,
    form_title VARCHAR(150) NOT NULL DEFAULT '',
    form_description TEXT NOT NULL,
    color VARCHAR(16) NOT NULL DEFAULT 'blue',
    audience VARCHAR(16) NOT NULL DEFAULT 'patients',
    access_mode VARCHAR(24) NOT NULL DEFAULT 'shared_link',
    identity_mode VARCHAR(24) NOT NULL DEFAULT 'anonymous',
    response_limit INT UNSIGNED NULL,
    opens_at DATETIME NULL,
    closes_at DATETIME NULL,
    completion_message VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    published_at DATETIME NULL,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_surveys_owner (owner_id,archived_at,updated_at,id),
    CONSTRAINT fk_surveys_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    item_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    type VARCHAR(24) NOT NULL,
    title VARCHAR(250) NOT NULL DEFAULT '',
    required TINYINT(1) NOT NULL DEFAULT 0,
    settings JSON NOT NULL,
    UNIQUE KEY uq_survey_item_key (survey_id,item_key),
    UNIQUE KEY uq_survey_item_position (survey_id,position),
    CONSTRAINT fk_survey_items_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_links (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    nonce CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    single_use TINYINT(1) NOT NULL,
    revoked_at DATETIME NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_survey_token_hash (token_hash),
    KEY ix_survey_links (survey_id,id),
    CONSTRAINT fk_survey_links_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_responses (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    link_id BIGINT UNSIGNED NOT NULL,
    submit_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    survey_version INT UNSIGNED NOT NULL,
    participant_name VARCHAR(100) NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_survey_submission (submit_hash),
    KEY ix_survey_responses (survey_id,submitted_at,id),
    CONSTRAINT fk_survey_response_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE RESTRICT,
    CONSTRAINT fk_survey_response_link FOREIGN KEY (link_id) REFERENCES survey_links(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_answers (
    response_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    answer JSON NOT NULL,
    PRIMARY KEY (response_id,item_id),
    KEY ix_survey_answers_item (item_id,response_id),
    CONSTRAINT fk_survey_answer_response FOREIGN KEY (response_id) REFERENCES survey_responses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_survey_answer_item FOREIGN KEY (item_id) REFERENCES survey_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- One current single-use password recovery credential per staff account.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    auth_version INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    UNIQUE KEY uq_password_reset_token (token_hash),
    CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
