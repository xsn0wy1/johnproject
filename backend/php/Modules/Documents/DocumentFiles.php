<?php
declare(strict_types=1);
namespace Hospital\Modules\Documents;
use Hospital\Http\ApiException;
use Hospital\Storage\PrivateStorage;

final class DocumentFiles
{
    public const MAX_BYTES = 10 * 1024 * 1024;
    private PrivateStorage $storage;
    private array $config;
    public function __construct(array $config) { $this->config = $config; $this->storage = new PrivateStorage($config); }

    public function stage(array $file): array
    {
        $error = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        if (!is_int($error) || $error !== UPLOAD_ERR_OK) throw new ApiException(in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 413 : 422, 'INVALID_UPLOAD', \Hospital\I18n::t("errors.no_se_recibio_un_archivo_valido"));
        if (!is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name']) || !is_string($file['name'] ?? null)) throw new ApiException(422, 'INVALID_UPLOAD', \Hospital\I18n::t("errors.se_requiere_un_archivo"));
        $size = filesize($file['tmp_name']);
        if (!$size || $size > self::MAX_BYTES) throw new ApiException($size ? 413 : 422, 'FILE_SIZE_INVALID', \Hospital\I18n::t("errors.el_archivo_debe_tener_contenido_y_no_superar_10_mib"));
        $name = basename(str_replace('\\', '/', $file['name']));
        if (!mb_check_encoding($name, 'UTF-8') || mb_strlen($name) > 255 || preg_match('/[\x00-\x1f\x7f:]/', $name)) throw new ApiException(422, 'INVALID_FILENAME', \Hospital\I18n::t("errors.el_nombre_de_archivo_no_es_valido"));
        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($extension, ['pdf', 'docx', 'jpg', 'jpeg', 'png'], true)) throw new ApiException(415, 'UNSUPPORTED_FILE', \Hospital\I18n::t("errors.usa_pdf_docx_jpg_o_png"));
        $key = bin2hex(random_bytes(32));
        $path = $this->storage->directory('quarantine', true) . '/' . $key . '.bin';
        if (!move_uploaded_file($file['tmp_name'], $path)) throw new \RuntimeException('Private upload staging failed.');
        chmod($path, 0600);
        try {
            $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path);
            if ($extension === 'pdf') {
                $handle = fopen($path, 'rb');
                try {
                    $header = fread($handle, 16); fseek($handle, max(0, $size - 2048)); $tail = stream_get_contents($handle);
                    $xref = '';
                    if (preg_match('/startxref\s+([0-9]{1,18})\s+%%EOF\s*$/', $tail, $offset) && (int) $offset[1] < $size) {
                        fseek($handle, (int) $offset[1]); $xref = fread($handle, 80);
                    }
                } finally { fclose($handle); }
                if ($mime !== 'application/pdf' || !preg_match('/^%PDF-(?:1\.[0-7]|2\.0)\b/', $header) || !preg_match('/^\s*(?:xref\b|[0-9]+\s+[0-9]+\s+obj\b)/', $xref)) $this->invalid();
            } elseif ($extension === 'docx') {
                $this->office($path); $mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            } else {
                $expected = $extension === 'png' ? 'image/png' : 'image/jpeg';
                $info = @getimagesize($path);
                if ($mime !== $expected || !$info || $info['mime'] !== $expected || max($info[0], $info[1]) > 8192 || $info[0] * $info[1] > 16000000) $this->invalid();
                $image = @imagecreatefromstring(file_get_contents($path));
                if (!$image) $this->invalid();
                imagedestroy($image);
                $extension = $extension === 'jpeg' ? 'jpg' : $extension;
            }
            $scan = $this->scan($path);
            return ['key' => $key, 'path' => $path, 'name' => $name, 'extension' => $extension, 'mime' => $mime, 'size' => $size, 'sha256' => hash_file('sha256', $path), 'scan_status' => $scan];
        } catch (\Throwable $error) { @unlink($path); throw $error; }
    }

    private function invalid(): void { throw new ApiException(415, 'INVALID_FILE_CONTENT', \Hospital\I18n::t("errors.el_contenido_no_corresponde_a_un_archivo_permitido")); }

    private function xml(string $bytes): \DOMDocument
    {
        if (stripos($bytes, '<!DOCTYPE') !== false || stripos($bytes, '<!ENTITY') !== false) $this->invalid();
        $xml = new \DOMDocument(); $previous = libxml_use_internal_errors(true);
        try { $valid = $xml->loadXML($bytes, LIBXML_NONET); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
        if (!$valid || $xml->doctype !== null) $this->invalid();
        return $xml;
    }

    private function office(string $path): void
    {
        $zip = new \ZipArchive();
        if ($zip->open($path, \ZipArchive::CHECKCONS) !== true) $this->invalid();
        try {
            if ($zip->numFiles < 3 || $zip->numFiles > 512) $this->invalid();
            $expanded = 0; $seen = [];
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->statIndex($i); $name = $entry['name'];
                $lower = strtolower($name); $expanded += $entry['size'];
                if (isset($seen[$lower]) || preg_match('#(^/|\\\\|(?:^|/)\.\.(?:/|$)|[\x00-\x1f])#', $name) || ($entry['encryption_method'] ?? 0) !== 0 || $expanded > 40 * 1024 * 1024 || $entry['size'] > 16 * 1024 * 1024 || preg_match('#(?:vbaproject|activex/|embeddings/|\.exe$|\.js$|\.html?$)#', $lower)) $this->invalid();
                $seen[$lower] = true;
                // Validate XML without resolving network resources/entities. Reject active links/objects.
                if (str_ends_with($lower, '.xml') || str_ends_with($lower, '.rels')) {
                    $bytes = $zip->getFromIndex($i);
                    if (!is_string($bytes) || strlen($bytes) !== $entry['size']) $this->invalid();
                    $xml = $this->xml($bytes);
                    if (str_ends_with($lower, '.rels')) {
                        if ($xml->documentElement->localName !== 'Relationships' || $xml->documentElement->namespaceURI !== 'http://schemas.openxmlformats.org/package/2006/relationships') $this->invalid();
                        foreach ((new \DOMXPath($xml))->query('//*[local-name()="Relationship"]') as $relationship) {
                            if (strtolower($relationship->getAttribute('TargetMode')) === 'external') {
                                $type=$relationship->getAttribute('Type');$target=$relationship->getAttribute('Target');
                                $hyperlink=in_array($type,['http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink','http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink'],true);
                                if (!$hyperlink || !preg_match('#^(https?://|mailto:)[^\x00-\x20]+$#i',$target)) $this->invalid();
                            }
                        }
                    }
                }
            }
            foreach (['[Content_Types].xml', '_rels/.rels', 'word/document.xml'] as $required) if ($zip->locateName($required) === false) $this->invalid();
            $types = $this->xml($zip->getFromName('[Content_Types].xml')); $found = false;
            foreach ($types->getElementsByTagNameNS('*', 'Override') as $item) {
                if ($item->getAttribute('PartName') === '/word/document.xml' && $item->getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') $found = true;
            }
            $root = $this->xml($zip->getFromName('word/document.xml'))->documentElement;
            if (!$found || $root->localName !== 'document' || !in_array($root->namespaceURI, ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'], true)) $this->invalid();
        } finally { $zip->close(); }
    }

    private function scan(string $path): string
    {
        $scanner = $this->config['document_scanner'];
        if ($scanner === '') return 'structure_validated';
        // Optional local ClamAV; fail closed when configured but unavailable.
        if (!is_file($scanner) || !is_executable($scanner)) throw new \RuntimeException('Document scanner unavailable.');
        $process = proc_open([$scanner, '--no-summary', '--infected', $path], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
        if (!is_resource($process)) throw new \RuntimeException('Document scanner unavailable.');
        $deadline = microtime(true) + 20; $exit = -1;
        try {
            do {
                $status = proc_get_status($process);
                if (!$status['running']) { $exit = $status['exitcode']; break; }
                if (microtime(true) >= $deadline) { proc_terminate($process, 9); throw new \RuntimeException('Document scanner timed out.'); }
                usleep(50000);
            } while (true);
        } finally { proc_close($process); }
        if ($exit === 1) throw new ApiException(415, 'FILE_REJECTED', \Hospital\I18n::t("errors.el_analisis_local_rechazo_el_archivo"));
        if ($exit !== 0) throw new \RuntimeException('Document scanner failed.');
        return 'antivirus_clean';
    }

    public function publish(array &$file): void
    {
        $destination = $this->storage->directory('documents', true) . '/' . $file['key'] . '.bin';
        if (file_exists($destination) || !rename($file['path'], $destination)) throw new \RuntimeException('Private upload publication failed.');
        $file['path'] = $destination;
    }
    public function discard(?array $file): void { if ($file !== null && is_file($file['path']) && !@unlink($file['path'])) error_log('Hospital document cleanup deferred.'); }
    public function path(string $key): string { return $this->storage->path('documents', $key); }
}
