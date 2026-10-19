-- Reuse the original route IDs and geometry; endpoints/stops may be free text.
ALTER TABLE route_templates MODIFY COLUMN origin_facility_id BIGINT UNSIGNED NULL;
ALTER TABLE route_templates MODIFY COLUMN destination_facility_id BIGINT UNSIGNED NULL;
ALTER TABLE route_templates ADD COLUMN origin_name VARCHAR(150) NOT NULL DEFAULT '';
ALTER TABLE route_templates ADD COLUMN origin_address VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE route_templates ADD COLUMN destination_name VARCHAR(150) NOT NULL DEFAULT '';
ALTER TABLE route_templates ADD COLUMN destination_address VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE route_templates ADD COLUMN category VARCHAR(24) NOT NULL DEFAULT 'interhospital';
ALTER TABLE route_templates ADD COLUMN direction VARCHAR(16) NOT NULL DEFAULT 'one_way';
ALTER TABLE route_templates ADD COLUMN availability VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE route_templates ADD COLUMN notes VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE route_templates ADD COLUMN archived_at DATETIME NULL;
ALTER TABLE route_templates ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE route_templates ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
UPDATE route_templates r JOIN facilities f ON f.id=r.origin_facility_id SET r.origin_name=f.name,r.origin_address=f.address WHERE r.origin_name='';
UPDATE route_templates r JOIN facilities f ON f.id=r.destination_facility_id SET r.destination_name=f.name,r.destination_address=f.address WHERE r.destination_name='';
UPDATE route_templates SET availability='inactive',status='active' WHERE status='inactive';
ALTER TABLE route_stops MODIFY COLUMN facility_id BIGINT UNSIGNED NULL;
ALTER TABLE route_stops ADD COLUMN name VARCHAR(150) NOT NULL DEFAULT '';
ALTER TABLE route_stops ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '';
UPDATE route_stops s JOIN facilities f ON f.id=s.facility_id SET s.name=f.name,s.address=f.address WHERE s.name='';
-- Copies the template itinerary, including its ordered stops, into each trace.
ALTER TABLE transfers ADD COLUMN route_snapshot LONGTEXT NULL;

CREATE TABLE IF NOT EXISTS route_map_cache (
    cache_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    payload LONGTEXT NOT NULL,
    expires_at DATETIME NOT NULL
) ENGINE=InnoDB;
