-- Enrich the shared centers catalog; saved centers are optional trace templates.
ALTER TABLE facilities ADD COLUMN locality VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE facilities ADD COLUMN facility_type VARCHAR(20) NOT NULL DEFAULT 'other';
ALTER TABLE facilities ADD COLUMN phone VARCHAR(25) NOT NULL DEFAULT '';
ALTER TABLE facilities ADD COLUMN notes VARCHAR(400) NOT NULL DEFAULT '';
ALTER TABLE facilities ADD COLUMN availability VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE facilities ADD COLUMN archived_at DATETIME NULL;
ALTER TABLE facilities DROP INDEX uq_facility_name;
ALTER TABLE facilities ADD CONSTRAINT uq_facility_identity UNIQUE (name,address,locality);
UPDATE facilities SET availability='inactive',status='active' WHERE status='inactive';

-- Snapshot text belongs to the trace even when no center/route template was used.
ALTER TABLE transfers MODIFY COLUMN origin_facility_id BIGINT UNSIGNED NULL;
ALTER TABLE transfers MODIFY COLUMN destination_facility_id BIGINT UNSIGNED NULL;
ALTER TABLE transfers MODIFY COLUMN route_template_id BIGINT UNSIGNED NULL;
ALTER TABLE transfers MODIFY COLUMN duration_seconds INT UNSIGNED NULL;
ALTER TABLE transfers MODIFY COLUMN distance_meters INT UNSIGNED NULL;
