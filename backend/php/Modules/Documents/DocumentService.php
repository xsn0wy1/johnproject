<?php
declare(strict_types=1);
namespace Hospital\Modules\Documents;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Auth\UserRepository;
use Hospital\Modules\Settings\SettingsService;

final class DocumentService
{
    private \PDO $db;
    private DocumentFiles $files;
    public function __construct(\PDO $db, array $config) { $this->db = $db; $this->files = new DocumentFiles($config); }

    private function manager(string $actor): bool { return in_array('records_manager', (new UserRepository($this->db))->roles($actor), true); }
    private function actor(string $actor): void
    {
        $user = (new UserRepository($this->db))->byId($actor, true);
        if (!$user || $user['status'] !== 'active' || $user['staff_status'] !== 'active' || (int) $user['auth_version'] !== (int) ($_SESSION['auth_version'] ?? 0)) throw new ApiException(401, 'SESSION_EXPIRED', 'La sesión ya no tiene acceso.');
    }
    private function missing(): void { throw new ApiException(404, 'DOCUMENT_NOT_FOUND', 'No se encontró el documento.'); }
    private function row(string $actor, string $id, bool $lock = false): array
    {
        $sql = 'SELECT d.*, c.code AS category_code, c.name AS category_name, c.requires_patient, p.full_name AS patient_name, p.national_id AS patient_national_id, p.status AS patient_status, COALESCE(NULLIF(s.full_name,\'\'), u.username) AS uploader_name FROM documents d JOIN document_categories c ON c.id = d.category_id LEFT JOIN patients p ON p.id = d.patient_id JOIN users u ON u.id = d.uploader_user_id JOIN staff s ON s.id = u.staff_id WHERE d.id = ?';
        $parameters = [$id];
        if (!$this->manager($actor)) { $sql .= ' AND d.uploader_user_id = ?'; $parameters[] = $actor; }
        $stmt = $this->db->prepare($sql . ($lock ? ' FOR UPDATE' : '')); $stmt->execute($parameters); $row = $stmt->fetch();
        if (!$row) $this->missing();
        return $row;
    }
    private function revision(array $row, $version): void
    {
        if ((!is_int($version) && !is_string($version)) || !preg_match('/^[1-9][0-9]{0,9}$/', (string) $version)) throw new ApiException(422, 'VERSION_REQUIRED', 'Se requiere la revisión actual.');
        if ((int) $row['version'] !== (int) $version) throw new ApiException(409, 'VERSION_CONFLICT', 'El documento cambió. Volvé a abrirlo antes de guardar.');
    }
    private function metadata(array $input, bool $lock = false, ?string $existingPatient = null): array
    {
        $description = $input['description'] ?? '';
        if (!is_string($description) || !mb_check_encoding($description, 'UTF-8')) throw new ApiException(422, 'VALIDATION_FAILED', 'Descripción no válida.');
        $description = trim(str_replace(["\r\n", "\r"], "\n", $description));
        if (mb_strlen($description, 'UTF-8') > 1000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|[\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u', $description)) throw new ApiException(422, 'VALIDATION_FAILED', 'Revisá la descripción y su longitud.');
        $fields = ['title' => SettingsService::text($input['title'] ?? null, 'title', 150, false),
            'description' => $description,
            'category_id' => Request::id($input['category_id'] ?? null)];
        $date = $input['document_date'] ?? null;
        if (!is_string($date) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $parts) || (int) $parts[1] < 1900 || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) throw new ApiException(422, 'VALIDATION_FAILED', 'Ingresá una fecha válida.', ['document_date' => 'Fecha inválida.']);
        $fields['document_date'] = $date;
        $stmt = $this->db->prepare('SELECT requires_patient FROM document_categories WHERE id = ?'); $stmt->execute([$fields['category_id']]); $category = $stmt->fetch();
        if (!$category) throw new ApiException(422, 'VALIDATION_FAILED', 'Seleccioná una categoría válida.');
        $patient = $input['patient_id'] ?? null;
        $fields['patient_id'] = ($patient === null || $patient === '') ? null : Request::id($patient);
        if ($category['requires_patient'] && $fields['patient_id'] === null) throw new ApiException(422, 'VALIDATION_FAILED', 'Seleccioná un paciente del hospital.', ['patient_id' => 'Paciente requerido.']);
        if ($fields['patient_id'] !== null) {
            $stmt = $this->db->prepare('SELECT id FROM patients WHERE id = ?' . ($fields['patient_id'] === $existingPatient ? '' : " AND status = 'active'") . ($lock ? ' FOR UPDATE' : '')); $stmt->execute([$fields['patient_id']]);
            if (!$stmt->fetchColumn()) throw new ApiException(422, 'VALIDATION_FAILED', 'Seleccioná un paciente activo del hospital.');
        }
        return $fields;
    }
    private function audit(string $actor, string $action, string $id): void
    {
        $stmt = $this->db->prepare("INSERT INTO audit_events (actor_user_id, action, resource_type, resource_id, request_id) VALUES (?, ?, 'document', ?, ?)");
        $stmt->execute([$actor, $action, $id, $GLOBALS['request_id']]);
    }
    private function addFile(string $actor, string $id, int $number, array $file): void
    {
        $stmt = $this->db->prepare("INSERT INTO stored_files (owner_user_id, storage_key, mime_type, byte_size, sha256, purpose, scan_status) VALUES (?, ?, ?, ?, ?, 'document', ?)");
        $stmt->execute([$actor, $file['key'], $file['mime'], $file['size'], $file['sha256'], $file['scan_status']]); $fileId = $this->db->lastInsertId();
        $stmt = $this->db->prepare('INSERT INTO document_versions (document_id, version_number, stored_file_id, uploaded_by, original_name, extension) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $number, $fileId, $actor, $file['name'], $file['extension']]);
    }

    public function create(string $actor, array $input, array $upload): array
    {
        $fields = $this->metadata($input);
        $key = $input['create_token'] ?? null;
        if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/', $key)) throw new ApiException(422, 'CREATE_TOKEN_REQUIRED', 'Se requiere la referencia de esta carga.');
        $file = $this->files->stage($upload); $committed = false;
        try {
            $fingerprint = hash('sha256', json_encode([$fields, $file['sha256'], $file['name']], JSON_THROW_ON_ERROR));
            $this->db->beginTransaction(); $this->actor($actor); $this->metadata($input, true);
            // The actor row serializes retries even from independent browser sessions.
            $stmt = $this->db->prepare('SELECT id, create_fingerprint FROM documents WHERE uploader_user_id = ? AND create_key = ?'); $stmt->execute([$actor, hash('sha256', $key)]); $existing = $stmt->fetch();
            if ($existing) {
                if (!hash_equals($existing['create_fingerprint'], $fingerprint)) throw new ApiException(409, 'CREATE_TOKEN_REUSED', 'Esta referencia de carga ya se utilizó con otros datos.');
                $id = (string) $existing['id']; $this->db->commit(); $this->files->discard($file);
                return $this->get($actor, $id);
            }
            $this->files->publish($file);
            $stmt = $this->db->prepare('INSERT INTO documents (uploader_user_id, patient_id, category_id, title, description, document_date, create_key, create_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$actor, $fields['patient_id'], $fields['category_id'], $fields['title'], $fields['description'], $fields['document_date'], hash('sha256', $key), $fingerprint]); $id = $this->db->lastInsertId();
            $this->addFile($actor, $id, 1, $file); $this->audit($actor, 'document.created', $id);
            $this->db->commit(); $committed = true;
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack(); throw $error;
        } finally { if (!$committed) $this->files->discard($file); }
        return $this->get($actor, $id);
    }

    public function update(string $actor, string $id, array $input, ?array $upload = null): array
    {
        $file = null; $committed = false;
        try {
            // Permission/version checks precede parsing potentially expensive uploads.
            $row = $this->row($actor, $id); $this->revision($row, $input['version'] ?? null);
            if ($row['archived_at'] !== null) throw new ApiException(409, 'DOCUMENT_ARCHIVED', 'Restaurá el documento antes de editarlo.');
            $hasMetadata = array_key_exists('title', $input);
            if ($upload === null || $hasMetadata) $this->metadata($input, false, $row['patient_id'] === null ? null : (string) $row['patient_id']);
            if ($upload !== null) $file = $this->files->stage($upload);
            $this->db->beginTransaction(); $this->actor($actor);
            $row = $this->row($actor, $id, true); $this->revision($row, $input['version'] ?? null);
            if ($row['archived_at'] !== null) throw new ApiException(409, 'DOCUMENT_ARCHIVED', 'Restaurá el documento antes de editarlo.');
            if ($upload === null || $hasMetadata) {
                $fields = $this->metadata($input, true, $row['patient_id'] === null ? null : (string) $row['patient_id']);
                $stmt = $this->db->prepare('UPDATE documents SET title = ?, description = ?, category_id = ?, patient_id = ?, document_date = ? WHERE id = ?');
                $stmt->execute([$fields['title'], $fields['description'], $fields['category_id'], $fields['patient_id'], $fields['document_date'], $id]);
            } elseif (array_diff(array_keys($input), ['id', 'version'])) throw new ApiException(422, 'VALIDATION_FAILED', 'Enviá todos los datos o solamente el archivo.');
            if ($file !== null) {
                $this->files->publish($file); $next = (int) $row['current_file_version'] + 1;
                $this->addFile($actor, $id, $next, $file);
                $stmt = $this->db->prepare('UPDATE documents SET current_file_version = ? WHERE id = ?'); $stmt->execute([$next, $id]);
            }
            $stmt = $this->db->prepare('UPDATE documents SET version = version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?'); $stmt->execute([$id]);
            $this->audit($actor, $file === null ? 'document.updated' : 'document.file_replaced', $id);
            $this->db->commit(); $committed = true;
        } catch (\Throwable $error) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $error; }
        finally { if (!$committed) $this->files->discard($file); }
        return $this->get($actor, $id);
    }

    public function archive(string $actor, string $id, $version, bool $restore = false): array
    {
        $this->db->beginTransaction();
        try {
            $this->actor($actor); $row = $this->row($actor, $id, true); $this->revision($row, $version);
            if (($row['archived_at'] === null) === $restore) throw new ApiException(409, 'DOCUMENT_STATE_CONFLICT', 'El estado del documento ya cambió.');
            $stmt = $this->db->prepare('UPDATE documents SET archived_at = ' . ($restore ? 'NULL' : 'UTC_TIMESTAMP()') . ', version = version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?'); $stmt->execute([$id]);
            $this->audit($actor, $restore ? 'document.restored' : 'document.archived', $id); $this->db->commit();
        } catch (\Throwable $error) { $this->db->rollBack(); throw $error; }
        return $this->get($actor, $id);
    }

    private function filePayload(array $row): array
    {
        return ['version' => (int) $row['version_number'], 'original_name' => $row['original_name'], 'extension' => $row['extension'], 'mime_type' => $row['mime_type'], 'byte_size' => (int) $row['byte_size'], 'sha256' => $row['sha256'], 'scan_status' => $row['scan_status'], 'created_at' => UserRepository::date($row['created_at'])];
    }
    private function versions(string $id): array
    {
        $stmt = $this->db->prepare("SELECT v.version_number, v.original_name, v.extension, v.created_at, f.mime_type, f.byte_size, f.sha256, f.scan_status FROM document_versions v JOIN stored_files f ON f.id = v.stored_file_id AND f.purpose = 'document' AND f.state = 'ready' WHERE v.document_id = ? ORDER BY v.version_number DESC"); $stmt->execute([$id]);
        return array_map(fn(array $row): array => $this->filePayload($row), $stmt->fetchAll());
    }
    private function payload(array $row, array $file): array
    {
        return ['id' => (string) $row['id'], 'version' => (int) $row['version'], 'title' => $row['title'], 'description' => $row['description'], 'document_date' => $row['document_date'],
            'category' => ['id' => (string) $row['category_id'], 'code' => $row['category_code'], 'name' => $row['category_name'], 'requires_patient' => (bool) $row['requires_patient']],
            'patient' => $row['patient_id'] === null ? null : ['id' => (string) $row['patient_id'], 'full_name' => $row['patient_name'], 'national_id' => $row['patient_national_id'], 'active' => $row['patient_status'] === 'active'],
            'uploader' => ['id' => (string) $row['uploader_user_id'], 'name' => $row['uploader_name']], 'file' => $file,
            'archived_at' => UserRepository::date($row['archived_at']), 'created_at' => UserRepository::date($row['created_at']), 'updated_at' => UserRepository::date($row['updated_at'])];
    }
    public function get(string $actor, string $id): array
    {
        $row = $this->row($actor, $id); $versions = $this->versions($id);
        $file = array_values(array_filter($versions, static fn(array $v): bool => $v['version'] === (int) $row['current_file_version']))[0] ?? null;
        if (!$file) $this->missing();
        $this->audit($actor, 'document.viewed', $id);
        return $this->payload($row, $file) + ['file_versions' => $versions];
    }

    public function listing(string $actor, array $query): array
    {
        if (array_diff(array_keys($query), ['page', 'page_size', 'q', 'type', 'sort', 'state'])) throw new ApiException(422, 'UNEXPECTED_FIELDS', 'Filtro no permitido.');
        foreach ($query as $value) if (!is_string($value)) throw new ApiException(422, 'VALIDATION_FAILED', 'Filtro inválido.');
        $page = $query['page'] ?? '1'; $size = $query['page_size'] ?? '20';
        if (!preg_match('/^[1-9][0-9]{0,5}$/', $page) || !preg_match('/^[1-9][0-9]{0,2}$/', $size) || (int) $size > 100) throw new ApiException(422, 'VALIDATION_FAILED', 'Paginación inválida.');
        $q = SettingsService::text($query['q'] ?? '', 'q', 150, true); $type = $query['type'] ?? ''; $sort = $query['sort'] ?? 'recent'; $state = $query['state'] ?? 'active';
        if (!in_array($type, ['', 'pdf', 'docx', 'png', 'jpg'], true) || !in_array($sort, ['recent', 'oldest'], true) || !in_array($state, ['active', 'archived'], true)) throw new ApiException(422, 'VALIDATION_FAILED', 'Filtro inválido.');
        $where = ['d.archived_at IS ' . ($state === 'active' ? 'NULL' : 'NOT NULL')]; $params = [];
        if (!$this->manager($actor)) { $where[] = 'd.uploader_user_id = ?'; $params[] = $actor; }
        if ($type !== '') { $where[] = 'v.extension = ?'; $params[] = $type; }
        if ($q !== '') {
            $where[] = "(d.title LIKE ? ESCAPE '!' OR d.description LIKE ? ESCAPE '!')";
            $pattern = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%'; array_push($params, $pattern, $pattern);
        }
        $join = " FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.version_number = d.current_file_version JOIN stored_files f ON f.id = v.stored_file_id AND f.state = 'ready' AND f.purpose = 'document' JOIN document_categories c ON c.id = d.category_id LEFT JOIN patients p ON p.id = d.patient_id JOIN users u ON u.id = d.uploader_user_id JOIN staff s ON s.id = u.staff_id WHERE " . implode(' AND ', $where);
        $stmt = $this->db->prepare('SELECT COUNT(*)' . $join); $stmt->execute($params); $total = (int) $stmt->fetchColumn();
        $order = $sort === 'oldest' ? 'ASC' : 'DESC'; $offset = ((int) $page - 1) * (int) $size;
        $stmt = $this->db->prepare("SELECT d.*, c.code AS category_code, c.name AS category_name, c.requires_patient, p.full_name AS patient_name, p.national_id AS patient_national_id, p.status AS patient_status, COALESCE(NULLIF(s.full_name,''), u.username) AS uploader_name, v.version_number, v.original_name, v.extension, v.created_at AS file_created_at, f.mime_type, f.byte_size, f.sha256, f.scan_status" . $join . " ORDER BY d.created_at $order, d.id $order LIMIT " . (int) $size . ' OFFSET ' . $offset); $stmt->execute($params);
        $items = array_map(function(array $row): array { $fileRow = $row; $fileRow['created_at'] = $row['file_created_at']; return $this->payload($row, $this->filePayload($fileRow)); }, $stmt->fetchAll());
        return ['items' => $items, 'page' => (int) $page, 'page_size' => (int) $size, 'total' => $total];
    }

    public function content(string $actor, string $id, ?string $version, bool $download): array
    {
        $row = $this->row($actor, $id);
        if ($row['archived_at'] !== null) $this->missing();
        $number = $version ?? (string) $row['current_file_version'];
        $stmt = $this->db->prepare("SELECT v.original_name, v.extension, f.storage_key, f.mime_type, f.byte_size FROM document_versions v JOIN stored_files f ON f.id = v.stored_file_id AND f.state = 'ready' AND f.purpose = 'document' WHERE v.document_id = ? AND v.version_number = ?"); $stmt->execute([$id, $number]); $file = $stmt->fetch();
        if (!$file) $this->missing();
        $path = $this->files->path($file['storage_key']);
        if (!is_file($path) || filesize($path) !== (int) $file['byte_size']) $this->missing();
        $this->audit($actor, $download ? 'document.downloaded' : 'document.previewed', $id);
        return ['path' => $path, 'name' => $file['original_name'], 'mime' => $file['mime_type'], 'size' => (int) $file['byte_size'], 'extension' => $file['extension']];
    }
}
