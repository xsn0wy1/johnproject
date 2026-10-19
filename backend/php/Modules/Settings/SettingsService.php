<?php
declare(strict_types=1);
namespace Hospital\Modules\Settings;

use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Auth\UserRepository;

final class SettingsService
{
    private \PDO $db;
    private UserRepository $users;
    public function __construct(\PDO $db) { $this->db = $db; $this->users = new UserRepository($db); }

    public static function text($value, string $field, int $max, bool $blank = true): string
    {
        if (!is_string($value)) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.campo_no_valido"), [$field => \Hospital\I18n::t("errors.se_esperaba_texto")]);
        $value = preg_replace('/\s+/u', ' ', trim($value));
        if ($value === null || (!$blank && $value === '') || mb_strlen($value, 'UTF-8') > $max || preg_match('/\p{C}/u', $value)) {
            throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.campo_no_valido"), [$field => \Hospital\I18n::t("errors.revisa_el_texto_y_su_longitud")]);
        }
        return $value;
    }

    public function lock(string $id, $version): array
    {
        if ((!is_int($version) && !is_string($version)) || !preg_match('/^[1-9][0-9]{0,9}$/', (string) $version)) throw new ApiException(422, 'VERSION_REQUIRED', \Hospital\I18n::t("errors.se_requiere_la_version_actual"));
        $user = $this->users->byId($id, true);
        if (!$user || $user['status'] !== 'active' || $user['staff_status'] !== 'active' || (int)$user['auth_version']!==(int)($_SESSION['auth_version']??0)) throw new ApiException(401, 'UNAUTHENTICATED', \Hospital\I18n::t("errors.la_cuenta_no_esta_activa"));
        $stmt = $this->db->prepare('SELECT * FROM user_settings WHERE user_id = ? FOR UPDATE'); $stmt->execute([$id]);
        $settings = $stmt->fetch();
        if (!$settings || (int) $settings['version']+(int)$user['staff_version'] !== (int) $version) throw new ApiException(409, 'VERSION_CONFLICT', \Hospital\I18n::t("errors.la_configuracion_cambio_en_otra_sesion"));
        return $user;
    }

    public function changed(string $id, string $action): void
    {
        $stmt = $this->db->prepare('UPDATE user_settings SET version = version + 1 WHERE user_id = ?'); $stmt->execute([$id]);
        $this->users->audit($id, $action, $id, $GLOBALS['request_id']);
    }

    public function profile(string $id, array $input): void
    {
        if (count($input) < 2) throw new ApiException(422, 'EMPTY_UPDATE', \Hospital\I18n::t("errors.no_se_indicaron_cambios"));
        $name = array_key_exists('full_name', $input) ? self::text($input['full_name'], 'full_name', 150) : null;
        $email = null;
        if (array_key_exists('email', $input)) {
            $email = strtolower(self::text($input['email'], 'email', 254, false));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.email_no_valido"), ['email' => \Hospital\I18n::t("errors.ingresa_un_email_valido")]);
        }
        $facility = null;
        if (array_key_exists('default_facility_id', $input) && $input['default_facility_id'] !== null) $facility = Request::id($input['default_facility_id']);
        $specialties = null;
        if (array_key_exists('specialties', $input)) {
            $list = $input['specialties'];
            if (!is_array($list) || count($list) > 10 || ($list !== [] && array_keys($list) !== range(0, count($list) - 1))) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.usa_una_lista_de_hasta_10_especializaciones"));
            $specialties = [];
            foreach ($input['specialties'] as $label) {
                $label = self::text($label, 'specialties', 80, false);
                $specialties[mb_strtolower($label, 'UTF-8')] = $label;
            }
        }
        $this->db->beginTransaction();
        try {
            $user = $this->lock($id, $input['version'] ?? null);
            if ($name !== null) {
                // The locked shared staff row also serializes doctor/personnel creation.
                // Include archived profiles and legacy crew that have only staff_roles.
                $stmt = $this->db->prepare("SELECT EXISTS(SELECT 1 FROM doctor_profiles WHERE staff_id = ?) OR EXISTS(SELECT 1 FROM personnel_profiles WHERE staff_id = ?) OR EXISTS(SELECT 1 FROM staff_roles WHERE staff_id = ? AND role_code IN ('driver','copilot'))");
                $stmt->execute([$user['staff_id'], $user['staff_id'], $user['staff_id']]);
                if ($stmt->fetchColumn()) $name = self::text($name, 'full_name', 100, false);
            }
            if ($email !== null) {
                $stmt = $this->db->prepare('UPDATE users SET email_verified_at = IF(email = ?, email_verified_at, NULL), email = ?, version = version + 1 WHERE id = ?'); $stmt->execute([$email, $email, $id]);
            }
            if ($name !== null) {
                $stmt = $this->db->prepare('UPDATE users SET display_name = ?, version = version + 1 WHERE id = ?'); $stmt->execute([$name, $id]);
                $stmt = $this->db->prepare('UPDATE staff SET full_name = ? WHERE id = ?'); $stmt->execute([$name, $user['staff_id']]);
            }
            if (array_key_exists('default_facility_id', $input)) {
                if ($facility !== null) {
                    $stmt = $this->db->prepare("SELECT id FROM facilities WHERE id = ? AND status = 'active' AND availability = 'active' LOCK IN SHARE MODE"); $stmt->execute([$facility]);
                    if (!$stmt->fetchColumn()) throw new ApiException(422, 'FACILITY_UNAVAILABLE', \Hospital\I18n::t("errors.el_centro_no_esta_disponible"));
                }
                $stmt = $this->db->prepare('UPDATE user_settings SET default_facility_id = ? WHERE user_id = ?'); $stmt->execute([$facility, $id]);
            }
            if ($specialties !== null) {
                $stmt = $this->db->prepare('DELETE FROM staff_specialties WHERE staff_id = ?'); $stmt->execute([$user['staff_id']]);
                foreach ($specialties as $label) {
                    $stmt = $this->db->prepare('INSERT INTO specialties (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'); $stmt->execute([$label]);
                    $specialtyId = $this->db->lastInsertId();
                    $stmt = $this->db->prepare("SELECT id FROM specialties WHERE id = ? AND status = 'active' LOCK IN SHARE MODE"); $stmt->execute([$specialtyId]);
                    if (!$stmt->fetchColumn()) throw new ApiException(422, 'SPECIALTY_UNAVAILABLE', \Hospital\I18n::t("errors.la_especializacion_no_esta_disponible"));
                    $stmt = $this->db->prepare('INSERT IGNORE INTO staff_specialties (staff_id, specialty_id) VALUES (?, ?)'); $stmt->execute([$user['staff_id'], $specialtyId]);
                }
            }
            if ($name !== null || $specialties !== null) {
                $stmt = $this->db->prepare('UPDATE staff SET version = version + 1 WHERE id = ?'); $stmt->execute([$user['staff_id']]);
            }
            $this->changed($id, 'settings.profile_updated'); $this->db->commit();
        } catch (\PDOException $error) {
            $this->db->rollBack();
            if (($error->errorInfo[1] ?? 0) === 1062) throw new ApiException(409, 'ACCOUNT_CONFLICT', \Hospital\I18n::t("errors.los_datos_ya_estan_en_uso"));
            throw $error;
        } catch (\Throwable $error) { $this->db->rollBack(); throw $error; }
    }

    public function preferences(string $id, array $input): void
    {
        if (count($input) < 2) throw new ApiException(422, 'EMPTY_UPDATE', \Hospital\I18n::t("errors.no_se_indicaron_cambios"));
        $fields = [];
        foreach (['locale' => ['es-UY', 'en'], 'theme' => ['dark']] as $key => $values) {
            if (array_key_exists($key, $input)) {
                if (!in_array($input[$key], $values, true)) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.preferencia_no_valida"));
                $fields[$key] = $input[$key];
            }
        }
        foreach (['photo_visible_to_staff', 'optional_diagnostics', 'security_notifications', 'automatic_logout'] as $key) {
            if (array_key_exists($key, $input)) {
                if (!is_bool($input[$key])) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.se_esperaba_un_booleano"));
                $fields[$key] = (int) $input[$key];
            }
        }
        $this->db->beginTransaction();
        try {
            $this->lock($id, $input['version'] ?? null);
            // Keys come only from the fixed allowlist above.
            $sql = implode(', ', array_map(static fn(string $key): string => $key . ' = ?', array_keys($fields)));
            $stmt = $this->db->prepare('UPDATE user_settings SET ' . $sql . ' WHERE user_id = ?'); $stmt->execute([...array_values($fields), $id]);
            if (($fields['optional_diagnostics'] ?? null) === 0) { $stmt = $this->db->prepare('DELETE FROM user_diagnostics WHERE user_id = ?'); $stmt->execute([$id]); }
            $this->changed($id, 'settings.preferences_updated'); $this->db->commit();
        } catch (\Throwable $error) { $this->db->rollBack(); throw $error; }
    }

    public function notifications(string $id): array
    {
        $stmt = $this->db->prepare('SELECT n.id, n.kind, n.created_at, n.read_at FROM user_notifications n JOIN user_settings s ON s.user_id = n.user_id WHERE n.user_id = ? AND s.security_notifications = 1 ORDER BY n.id DESC LIMIT 20'); $stmt->execute([$id]);
        return array_map(static fn(array $row): array => ['id' => (string) $row['id'], 'kind' => $row['kind'], 'created_at' => UserRepository::date($row['created_at']), 'read_at' => UserRepository::date($row['read_at'])], $stmt->fetchAll());
    }

    public function readNotifications(string $id, string $through): void
    {
        $stmt = $this->db->prepare('UPDATE user_notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE user_id = ? AND id <= ?'); $stmt->execute([$id, $through]);
    }

    public function diagnostics(string $id, $duration): void
    {
        if (!is_int($duration) || $duration < 0 || $duration > 120000) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.duracion_no_valida"));
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT optional_diagnostics FROM user_settings WHERE user_id = ? FOR UPDATE'); $stmt->execute([$id]);
            if (!(bool) $stmt->fetchColumn()) throw new ApiException(403, 'DIAGNOSTICS_DISABLED', \Hospital\I18n::t("errors.el_analisis_opcional_esta_desactivado"));
            $stmt = $this->db->prepare('INSERT INTO user_diagnostics (user_id, sample_count, total_load_ms, last_recorded_at) VALUES (?, 1, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE sample_count = sample_count + 1, total_load_ms = total_load_ms + VALUES(total_load_ms), last_recorded_at = UTC_TIMESTAMP()'); $stmt->execute([$id, $duration]);
            $this->db->commit();
        } catch (\Throwable $error) { $this->db->rollBack(); throw $error; }
    }
}
