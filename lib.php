<?php
declare(strict_types=1);

const MAX_PHOTOS = 5;
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

// Visits, the password and photos live outside the web folder so a redeploy from Git
// never touches them and nobody can download them directly.
function data_dir(): string
{
    static $dir = null;
    if ($dir !== null) return $dir;
    $dir = getenv('LIGHTHOUSE_DATA') ?: dirname((string)realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__ . '/..')) . '/lighthouse-data';
    if (!is_dir($dir . '/photos') && !mkdir($dir . '/photos', 0750, true) && !is_dir($dir . '/photos')) {
        throw new RuntimeException('Could not create the data folder at ' . $dir);
    }
    return $dir;
}

function start_session(): void
{
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 60,
        'path'     => '/',
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 60));
    session_name('lighthouse_log');
    session_start();
}

function signed_in(): bool { return !empty($_SESSION['owner']); }

function sign_in(): void
{
    session_regenerate_id(true);
    $_SESSION['owner'] = true;
}

function require_owner(): void
{
    if (!signed_in()) fail(401, 'Sign in to make changes.');
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

function check_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals(csrf_token(), $sent)) fail(403, 'Your session expired. Reload the page and try again.');
}

function respond(array $body): never
{
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $code, string $message): never
{
    http_response_code($code);
    respond(['error' => $message]);
}

function lighthouses(): array
{
    return json_decode((string)file_get_contents(__DIR__ . '/lighthouses.json'), true, 16, JSON_THROW_ON_ERROR);
}

function lighthouse_id(mixed $id): string
{
    $id = (string)$id;
    foreach (lighthouses() as $l) if ($l['id'] === $id) return $id;
    fail(400, 'Unknown lighthouse.');
}

function read_json(string $name, mixed $default): mixed
{
    $path = data_dir() . '/' . $name;
    if (!is_file($path)) return $default;
    $data = json_decode((string)file_get_contents($path), true);
    return $data ?? $default;
}

function write_json(string $name, mixed $data): void
{
    $path = data_dir() . '/' . $name;
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents($tmp, $json, LOCK_EX) === false || !rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('Could not save your changes. Check that the data folder is writable.');
    }
}

function public_visits(): array|stdClass
{
    $out = [];
    foreach (read_json('visits.json', []) as $id => $v) {
        $v['photos'] = array_map(fn($f) => [
            'file'  => $f,
            'full'  => 'photo.php?id=' . rawurlencode($id) . '&f=' . rawurlencode($f),
            'thumb' => 'photo.php?id=' . rawurlencode($id) . '&f=' . rawurlencode($f) . '&thumb=1',
        ], $v['photos'] ?? []);
        $out[$id] = $v;
    }
    return $out ?: new stdClass();
}

function photo_path(string $id, string $file, bool $thumb = false): ?string
{
    if (!preg_match('/^[a-z0-9-]+$/', $id) || !preg_match('/^[a-f0-9]{24}\.(jpg|png|webp)$/', $file)) return null;
    return data_dir() . '/photos/' . $id . '/' . ($thumb ? 'thumb-' . preg_replace('/\.\w+$/', '.jpg', $file) : $file);
}

function store_upload(string $id, ?array $f): string
{
    if (!$f || !isset($f['error'])) fail(400, 'No photo was received.');
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || $f['size'] > MAX_UPLOAD_BYTES) {
        fail(413, 'That photo is too large. The limit is ' . (MAX_UPLOAD_BYTES >> 20) . ' MB.');
    }
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) fail(400, 'The upload did not finish. Try again.');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    if (!isset(PHOTO_TYPES[$mime])) fail(415, 'Use a JPEG, PNG or WebP photo.');
    $name = bin2hex(random_bytes(12)) . '.' . PHOTO_TYPES[$mime];
    $dest = photo_path($id, $name);
    if (!is_dir(dirname($dest))) mkdir(dirname($dest), 0750, true);
    if (!move_uploaded_file($f['tmp_name'], $dest)) throw new RuntimeException('Could not store the photo.');
    make_thumb($dest, photo_path($id, $name, true), $mime);
    return $name;
}

// A small preview so the page stays quick on a phone; the original is kept untouched.
function make_thumb(string $src, string $dest, string $mime): void
{
    if (!function_exists('imagecreatefromjpeg')) return;
    $img = match ($mime) {
        'image/jpeg' => @imagecreatefromjpeg($src),
        'image/png'  => @imagecreatefrompng($src),
        'image/webp' => @imagecreatefromwebp($src),
        default      => false,
    };
    if (!$img) return;
    if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
        $o = (int)(@exif_read_data($src)['Orientation'] ?? 1);
        $img = match ($o) { 3 => imagerotate($img, 180, 0), 6 => imagerotate($img, -90, 0), 8 => imagerotate($img, 90, 0), default => $img };
    }
    $w = imagesx($img); $h = imagesy($img);
    $scale = min(1, 800 / max($w, $h));
    $t = imagescale($img, max(1, (int)round($w * $scale)), max(1, (int)round($h * $scale)));
    if ($t) imagejpeg($t, $dest, 82);
}

function delete_photo_files(string $id, string $file): void
{
    foreach ([false, true] as $thumb) {
        $p = photo_path($id, $file, $thumb);
        if ($p && is_file($p)) unlink($p);
    }
}
