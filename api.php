<?php
// JSON API for the lighthouse log. Anyone can read; only the signed-in owner can write.
declare(strict_types=1);
require __DIR__ . '/lib.php';

start_session();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET' && $action === 'state') {
        respond([
            'lighthouses' => lighthouses(),
            'visits'      => public_visits(),
            'signedIn'    => signed_in(),
            'needsSetup'  => !is_file(data_dir() . '/auth.json'),
            'csrf'        => csrf_token(),
        ]);
    }

    if ($method !== 'POST') fail(405, 'Unsupported request.');
    check_csrf();

    switch ($action) {
        case 'setup':
            if (is_file(data_dir() . '/auth.json')) fail(403, 'A password is already set.');
            $pw = (string)($_POST['password'] ?? '');
            if (strlen($pw) < 10) fail(400, 'Use at least 10 characters.');
            write_json('auth.json', ['hash' => password_hash($pw, PASSWORD_DEFAULT), 'failures' => []]);
            sign_in();
            respond(['ok' => true]);

        case 'login':
            $auth = read_json('auth.json', null);
            if (!$auth) fail(400, 'No password has been set yet.');
            $recent = array_values(array_filter($auth['failures'] ?? [], fn($t) => $t > time() - 900));
            if (count($recent) >= 10) fail(429, 'Too many wrong tries. Wait 15 minutes and try again.');
            if (!password_verify((string)($_POST['password'] ?? ''), $auth['hash'])) {
                $recent[] = time();
                $auth['failures'] = $recent;
                write_json('auth.json', $auth);
                usleep(700000);
                fail(401, 'That password is not right.');
            }
            $auth['failures'] = [];
            write_json('auth.json', $auth);
            sign_in();
            respond(['ok' => true]);

        case 'logout':
            $_SESSION = [];
            session_destroy();
            respond(['ok' => true]);

        case 'save':
            require_owner();
            $id = lighthouse_id($_POST['id'] ?? '');
            $status = $_POST['status'] ?? '';
            if (!in_array($status, ['toured', 'seen'], true)) fail(400, 'Pick toured or seen.');
            $date = (string)($_POST['date'] ?? '');
            if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) fail(400, 'That date is not valid.');
            $notes = substr((string)($_POST['notes'] ?? ''), 0, 50000);
            $visits = read_json('visits.json', []);
            $visits[$id] = [
                'status' => $status,
                'date'   => $date,
                'notes'  => $notes,
                'photos' => $visits[$id]['photos'] ?? [],
            ];
            write_json('visits.json', $visits);
            respond(['visits' => public_visits()]);

        case 'remove':
            require_owner();
            $id = lighthouse_id($_POST['id'] ?? '');
            $visits = read_json('visits.json', []);
            foreach ($visits[$id]['photos'] ?? [] as $f) delete_photo_files($id, $f);
            unset($visits[$id]);
            write_json('visits.json', $visits);
            respond(['visits' => public_visits()]);

        case 'upload':
            require_owner();
            $id = lighthouse_id($_POST['id'] ?? '');
            $visits = read_json('visits.json', []);
            if (!isset($visits[$id])) fail(400, 'Save the visit before adding photos.');
            if (count($visits[$id]['photos']) >= MAX_PHOTOS) fail(400, 'This lighthouse already has ' . MAX_PHOTOS . ' photos.');
            $name = store_upload($id, $_FILES['photo'] ?? null);
            $visits[$id]['photos'][] = $name;
            write_json('visits.json', $visits);
            respond(['visits' => public_visits()]);

        case 'delete-photo':
            require_owner();
            $id = lighthouse_id($_POST['id'] ?? '');
            $file = (string)($_POST['file'] ?? '');
            $visits = read_json('visits.json', []);
            $photos = $visits[$id]['photos'] ?? [];
            if (!in_array($file, $photos, true)) fail(404, 'That photo is already gone.');
            delete_photo_files($id, $file);
            $visits[$id]['photos'] = array_values(array_diff($photos, [$file]));
            write_json('visits.json', $visits);
            respond(['visits' => public_visits()]);
    }
    fail(404, 'Unknown action.');
} catch (RuntimeException $e) {
    fail(500, $e->getMessage());
}
