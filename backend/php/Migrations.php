<?php
declare(strict_types=1);
namespace Hospital;

final class Migrations
{
    public static function apply(\PDO $db, string $database): void
    {
        $lock = 'hm:' . substr(hash('sha256', $database), 0, 61);
        $stmt = $db->prepare('SELECT GET_LOCK(?, 10)'); $stmt->execute([$lock]);
        if ((int) $stmt->fetchColumn() !== 1) throw new \RuntimeException('Migration lock unavailable.');
        try {
            foreach (glob(dirname(__DIR__, 2) . '/db/sql/migrations/*.sql') as $file) {
                $version = basename($file, '.sql');
                $stmt = $db->prepare('SELECT version FROM schema_migrations WHERE version = ?'); $stmt->execute([$version]);
                if ($stmt->fetchColumn()) continue;
                // Controlled migration files only. Statements use semicolon/newline boundaries.
                $sql = preg_replace('/^--.*$/m', '', file_get_contents($file));
                foreach (preg_split('/;\s*(?:\r?\n|$)/', $sql) as $statement) {
                    $statement = trim($statement); if ($statement === '') continue;
                    // MySQL DDL commits implicitly: make retries after partial failure safe.
                    if (preg_match('/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i', $statement, $match)) {
                        $check = $db->prepare('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
                        $check->execute([$database, $match[1], $match[2]]); if ($check->fetchColumn()) continue;
                    }
                    if (preg_match('/^ALTER TABLE (\w+) ADD CONSTRAINT (\w+)/i', $statement, $match)) {
                        $check = $db->prepare('SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?');
                        $check->execute([$database, $match[1], $match[2]]); if ($check->fetchColumn()) continue;
                    }
                    if (preg_match('/^ALTER TABLE (\w+) DROP INDEX (\w+)/i', $statement, $match)) {
                        $check = $db->prepare('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?');
                        $check->execute([$database, $match[1], $match[2]]); if (!$check->fetchColumn()) continue;
                    }
                    $db->exec($statement);
                }
                $stmt = $db->prepare('INSERT INTO schema_migrations (version) VALUES (?)'); $stmt->execute([$version]);
            }
        } finally { $stmt = $db->prepare('SELECT RELEASE_LOCK(?)'); $stmt->execute([$lock]); }
    }
}
