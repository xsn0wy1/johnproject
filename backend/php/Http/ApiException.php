<?php
declare(strict_types=1);
namespace Hospital\Http;

final class ApiException extends \RuntimeException
{
    public int $status;
    public string $errorCode;
    public array $fields;

    public function __construct(int $status, string $code, string $message, array $fields = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $code;
        $this->fields = $fields;
    }
}
