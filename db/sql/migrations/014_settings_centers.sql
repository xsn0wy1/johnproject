-- The two institution choices in Settings use ordinary shared facility IDs.
-- Reuse existing names without renaming, duplicating or restoring managed records.
INSERT INTO facilities (name, facility_type)
SELECT 'Hospital de Clinicas de Montevideo', 'hospital'
WHERE NOT EXISTS (SELECT 1 FROM facilities WHERE name = 'Hospital de Clinicas de Montevideo');

INSERT INTO facilities (name, facility_type)
SELECT 'Facultad de Medicina', 'other'
WHERE NOT EXISTS (SELECT 1 FROM facilities WHERE name = 'Facultad de Medicina');
