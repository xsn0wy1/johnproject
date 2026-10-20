-- One reusable, expiring patient capability per immutable document file version.
CREATE TABLE IF NOT EXISTS document_access_links (
    document_version_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    nonce CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    UNIQUE KEY uq_document_access_token (token_hash),
    CONSTRAINT fk_document_access_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_access_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
