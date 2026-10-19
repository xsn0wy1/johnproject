<?php
declare(strict_types=1);
namespace Hospital\Modules\Auth;

use Hospital\Http\ApiException;
use Hospital\I18n;

/** Small transactional sender; the optional transport keeps focused tests offline. */
final class BrevoMailer
{
    private array $config;
    private $transport;

    public function __construct(array $config, ?callable $transport = null)
    {
        $this->config = $config;
        $this->transport = $transport;
    }

    public function requireConfiguration(): void
    {
        $url = parse_url($this->config['app_url'] ?? '');
        if (trim($this->config['brevo_api_key'] ?? '') === '' ||
            preg_match('/[\r\n]/', $this->config['brevo_api_key']) ||
            !filter_var($this->config['mail_from_email'] ?? '', FILTER_VALIDATE_EMAIL) ||
            !$url || !in_array($url['scheme'] ?? '', ['http', 'https'], true) || empty($url['host']) ||
            isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) ||
            rtrim($url['path'] ?? '', '/') !== ($this->config['base_path'] ?? '')) {
            throw new ApiException(503, 'RECOVERY_UNAVAILABLE', I18n::t('recovery.unavailable'));
        }
    }

    public function sendReset(string $email, string $url): void
    {
        $payload = [
            'sender' => ['email' => $this->config['mail_from_email'], 'name' => $this->config['mail_from_name']],
            'to' => [['email' => $email]],
            'subject' => I18n::t('recovery.email_subject'),
            // Plain text keeps the recovery URL readable/copyable without an HTML template.
            'textContent' => I18n::t('recovery.email_body', ['url' => $url]),
        ];
        if ($this->transport !== null) { ($this->transport)($payload); return; }
        $handle = curl_init('https://api.brevo.com/v3/smtp/email');
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'api-key: ' . $this->config['brevo_api_key']],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 10,
        ]);
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        if ($response === false || $status !== 201 || !is_string(json_decode($response, true)['messageId'] ?? null)) {
            // Provider responses may contain addresses or request details; never log them.
            throw new \RuntimeException('Email delivery was not accepted.');
        }
    }
}
