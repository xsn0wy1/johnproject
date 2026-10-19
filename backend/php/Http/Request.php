<?php
declare(strict_types=1);
namespace Hospital\Http;

final class Request
{
    public static function method(string ...$expected): void
    {
        if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $expected, true)) {
            header('Allow: ' . implode(', ', $expected));
            throw new ApiException(405, 'METHOD_NOT_ALLOWED', 'Método no permitido.');
        }
    }

    public static function body(array $allowed, array $arrayFields = [], int $limit = 16384): array
    {
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) {
            throw new ApiException(413, 'REQUEST_TOO_LARGE', 'La solicitud es demasiado grande.');
        }
        $type = strtolower(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]);
        if ($type === 'application/json') {
            $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
            if (strlen($raw) > $limit) throw new ApiException(413, 'REQUEST_TOO_LARGE', 'La solicitud es demasiado grande.');
            try { $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
            catch (\JsonException $e) { throw new ApiException(400, 'INVALID_JSON', 'El JSON no es válido.'); }
            if (!is_array($body) || !str_starts_with(ltrim($raw), '{')) throw new ApiException(400, 'INVALID_JSON', 'Se esperaba un objeto JSON.');
        } elseif (in_array($type, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
            $body = $_POST;
        } else {
            throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', 'Usá JSON o un formulario válido.');
        }
        if (array_diff(array_keys($body), $allowed)) {
            throw new ApiException(422, 'UNEXPECTED_FIELDS', 'La solicitud contiene campos no permitidos.');
        }
        foreach ($body as $key => $value) {
            if (in_array($key, $arrayFields, true) && is_array($value)) continue;
            if (!is_string($value) && !is_int($value) && !is_bool($value) && $value !== null) {
                throw new ApiException(422, 'VALIDATION_FAILED', 'Los campos deben contener valores simples.');
            }
        }
        return $body;
    }

    public static function id($value): string
    {
        if ((!is_string($value) && !is_int($value)) || !preg_match('/^[1-9][0-9]{0,17}$/', (string) $value)) {
            throw new ApiException(422, 'VALIDATION_FAILED', 'El identificador no es válido.');
        }
        return (string) $value;
    }
}
