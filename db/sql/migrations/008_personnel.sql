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
