-- Extend an existing identity database without replacing account data.
CREATE TABLE IF NOT EXISTS facilities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_facility_name (name)
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
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_file_storage_key (storage_key),
    CONSTRAINT fk_file_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE user_settings ADD COLUMN default_facility_id BIGINT UNSIGNED NULL;
ALTER TABLE user_settings ADD COLUMN avatar_file_id BIGINT UNSIGNED NULL;
ALTER TABLE user_settings ADD CONSTRAINT fk_settings_facility FOREIGN KEY (default_facility_id) REFERENCES facilities(id) ON DELETE RESTRICT;
ALTER TABLE user_settings ADD CONSTRAINT fk_settings_avatar FOREIGN KEY (avatar_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL;

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
