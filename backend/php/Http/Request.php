<?php
declare(strict_types=1);
namespace Hospital\Http;

final class Request
{
    public static function method(string ...$expected): void
    {
        if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $expected, true)) {
            header('Allow: ' . implode(', ', $expected));
            throw new ApiException(405, 'METHOD_NOT_ALLOWED', \Hospital\I18n::t("errors.metodo_no_permitido"));
        }
    }

    public static function body(array $allowed, array $arrayFields = [], int $limit = 16384): array
    {
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) {
            throw new ApiException(413, 'REQUEST_TOO_LARGE', \Hospital\I18n::t("errors.la_solicitud_es_demasiado_grande"));
        }
        $type = strtolower(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]);
        if ($type === 'application/json') {
            $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
            if (strlen($raw) > $limit) throw new ApiException(413, 'REQUEST_TOO_LARGE', \Hospital\I18n::t("errors.la_solicitud_es_demasiado_grande"));
            try { $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
            catch (\JsonException $e) { throw new ApiException(400, 'INVALID_JSON', \Hospital\I18n::t("errors.el_json_no_es_valido")); }
            if (!is_array($body) || !str_starts_with(ltrim($raw), '{')) throw new ApiException(400, 'INVALID_JSON', \Hospital\I18n::t("errors.se_esperaba_un_objeto_json"));
        } elseif (in_array($type, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
            $body = $_POST;
        } else {
            throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', \Hospital\I18n::t("errors.usa_json_o_un_formulario_valido"));
        }
        if (array_diff(array_keys($body), $allowed)) {
            throw new ApiException(422, 'UNEXPECTED_FIELDS', \Hospital\I18n::t("errors.la_solicitud_contiene_campos_no_permitidos"));
        }
        foreach ($body as $key => $value) {
            if (in_array($key, $arrayFields, true) && is_array($value)) continue;
            if (!is_string($value) && !is_int($value) && !is_bool($value) && $value !== null) {
                throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.los_campos_deben_contener_valores_simples"));
            }
        }
        return $body;
    }

    public static function id($value): string
    {
        if ((!is_string($value) && !is_int($value)) || !preg_match('/^[1-9][0-9]{0,17}$/', (string) $value)) {
            throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.el_identificador_no_es_valido"));
        }
        return (string) $value;
    }
}
