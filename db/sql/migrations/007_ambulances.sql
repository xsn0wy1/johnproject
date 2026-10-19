-- Preserve vehicle IDs already referenced by transfers; removal is recoverable.
ALTER TABLE ambulances ADD COLUMN archived_at DATETIME NULL;
