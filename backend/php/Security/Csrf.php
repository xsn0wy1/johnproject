<?php
declare(strict_types=1);
namespace Hospital\Security;
use Hospital\Http\ApiException;

final class Csrf
{
    public static function token(): string
    {
        if (!isset($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        return $_SESSION['csrf_token'];
    }

    public static function verify(): void
    {
        $given = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($given) || !isset($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $given)) {
            throw new ApiException(403, 'CSRF_INVALID', 'La sesión del formulario venció. Volvé a intentarlo.');
        }
    }
}
