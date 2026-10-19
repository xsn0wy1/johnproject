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
