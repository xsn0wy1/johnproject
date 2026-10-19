-- Extend the canonical identities already referenced by documents and transfers.
ALTER TABLE patients ADD COLUMN estimated_age SMALLINT UNSIGNED NULL;
ALTER TABLE patients ADD COLUMN age_recorded_on DATE NULL;
ALTER TABLE patients ADD COLUMN phone VARCHAR(25) NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN blood_group VARCHAR(3) NULL;
ALTER TABLE patients ADD COLUMN allergies VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN archived_at DATETIME NULL;
ALTER TABLE patients ADD COLUMN create_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE patients ADD COLUMN create_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE patients ADD CONSTRAINT uq_patient_create_key UNIQUE (create_key);

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
