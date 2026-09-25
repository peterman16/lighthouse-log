<?php
// Serves stored photos (and their previews) from the private data folder.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$id = (string)($_GET['id'] ?? '');
$file = (string)($_GET['f'] ?? '');
$thumb = !empty($_GET['thumb']);

$visits = read_json('visits.json', []);
$path = in_array($file, $visits[$id]['photos'] ?? [], true) ? photo_path($id, $file, $thumb) : null;
if ($path && $thumb && !is_file($path)) $path = photo_path($id, $file);
if (!$path || !is_file($path)) {
    http_response_code(404);
    exit;
}

$type = (new finfo(FILEINFO_MIME_TYPE))->file($path);
header('Content-Type: ' . $type);
header('Content-Length: ' . filesize($path));
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
readfile($path);
