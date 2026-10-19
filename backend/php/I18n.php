<?php
declare(strict_types=1);
namespace Hospital;

/** Reads the same public interface dictionaries as the browser; never translates record values. */
final class I18n
{
    private static array $dictionaries = [];

    public static function locale(): string
    {
        return ($_SERVER['HTTP_X_HOSPITAL_LOCALE'] ?? '') === 'en' ? 'en' : 'es-UY';
    }

    private static function dictionary(string $language): array
    {
        if (!array_key_exists($language, self::$dictionaries)) {
            $path = dirname(__DIR__, 2) . '/public/assets/i18n/' . $language . '.json';
            $contents = @file_get_contents($path);
            $data = $contents === false ? null : json_decode($contents, true);
            self::$dictionaries[$language] = is_array($data) ? $data : [];
        }
        return self::$dictionaries[$language];
    }

    public static function t(string $key, array $params = []): string
    {
        $selected = self::dictionary(self::locale() === 'en' ? 'en' : 'es');
        $spanish = self::dictionary('es');
        $value = $selected[$key] ?? $spanish[$key] ?? '';
        if (is_array($value)) {
            $form = (float) ($params['count'] ?? 0) === 1.0 ? 'one' : 'other';
            $value = $value[$form] ?? (is_array($spanish[$key] ?? null) ? ($spanish[$key][$form] ?? '') : '');
        }
        if (!is_string($value) && is_string($spanish[$key] ?? null)) $value = $spanish[$key];
        if (!is_string($value)) return '';
        return preg_replace_callback('/\{([a-zA-Z][a-zA-Z0-9_]*)\}/', static fn(array $match): string => array_key_exists($match[1], $params) ? (string) $params[$match[1]] : $match[0], $value) ?? '';
    }
}
