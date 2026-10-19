-- Minimal shared patient identities. Hospital management owns this catalog;
-- document upload must never create patients from arbitrary text.
CREATE TABLE IF NOT EXISTS patients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    national_id VARCHAR(20) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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

ALTER TABLE stored_files ADD COLUMN purpose VARCHAR(16) NOT NULL DEFAULT 'avatar';
ALTER TABLE stored_files ADD COLUMN scan_status VARCHAR(32) NOT NULL DEFAULT 'image_normalized';

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
