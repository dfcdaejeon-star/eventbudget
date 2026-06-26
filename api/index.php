<?php
/**
 * EventMoney PHP API
 * 단일 파일 REST API 백엔드
 */

// ── 헤더 ─────────────────────────────────────────────────────────────

// 디버그: 500 오류 원인 확인용 (문제 해결 후 아래 두 줄 삭제)
ini_set('display_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── 경로 설정 ─────────────────────────────────────────────────────────

define('ROOT_DIR',   dirname(__DIR__));
define('DATA_DIR',   ROOT_DIR . '/data/events');
define('UPLOAD_DIR', ROOT_DIR . '/uploads');
define('BACKUP_DIR', ROOT_DIR . '/backups');

// 디렉터리 생성
@mkdir(DATA_DIR,   0755, true);
@mkdir(UPLOAD_DIR, 0755, true);
@mkdir(BACKUP_DIR, 0755, true);

// ── 설정 로드 ─────────────────────────────────────────────────────────

$configFile = ROOT_DIR . '/config.php';
if (file_exists($configFile)) {
    require_once $configFile;
}
if (!defined('ADMIN_PASSWORD')) {
    define('ADMIN_PASSWORD', 'eventmoney');
}

// ── 라우터 ────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'];
$uri    = $_SERVER['REQUEST_URI'];
$path   = parse_url($uri, PHP_URL_PATH);

// /api 이후 경로 추출
$path     = preg_replace('#^.*/api(/|$)#', '', $path);
$path     = trim($path, '/');
$segments = ($path !== '') ? explode('/', $path) : [];

$resource = $segments[0] ?? '';
$param1   = $segments[1] ?? null;

if ($resource === 'auth' && $method === 'POST') {
    route_auth();
} elseif ($resource === 'events') {
    route_events($method, $param1);
} else {
    json_error(404, '엔드포인트를 찾을 수 없습니다.');
}

// ── 인증 ──────────────────────────────────────────────────────────────

function route_auth(): void
{
    $body     = json_input();
    $password = $body['password'] ?? '';

    if ($password === ADMIN_PASSWORD) {
        echo json_encode(['ok' => true]);
    } else {
        json_error(401, '비밀번호가 올바르지 않습니다.');
    }
}

// ── 이벤트 라우팅 ─────────────────────────────────────────────────────

function route_events(string $method, ?string $param1): void
{
    // POST /events/backup
    if ($method === 'POST' && $param1 === 'backup') {
        events_backup(); return;
    }
    // GET /events/backups
    if ($method === 'GET' && $param1 === 'backups') {
        events_list_backups(); return;
    }
    // POST /events/restore
    if ($method === 'POST' && $param1 === 'restore') {
        events_restore(); return;
    }
    // POST /events/receipt
    if ($method === 'POST' && $param1 === 'receipt') {
        events_upload_receipt(); return;
    }

    if ($param1 === null) {
        if ($method === 'GET')  { events_list(); return; }
        if ($method === 'POST') { events_save(); return; }
    } else {
        $id = sanitize_id($param1);
        if ($method === 'GET')    { events_get($id); return; }
        if ($method === 'DELETE') { events_delete($id); return; }
    }

    json_error(405, '허용되지 않는 메서드입니다.');
}

// ── 이벤트 핸들러 ─────────────────────────────────────────────────────

function events_list(): void
{
    echo json_encode(['events' => array_values(load_all_events())]);
}

function events_get(string $id): void
{
    $event = load_event($id);
    if ($event === null) { json_error(404, '이벤트를 찾을 수 없습니다.'); }
    echo json_encode(['event' => $event]);
}

function events_save(): void
{
    $data = json_input();
    $errors = validate_event($data);
    if ($errors) { json_error(400, '유효성 검사 실패', $errors); }
    save_event($data);
    echo json_encode(['event' => $data]);
}

function events_delete(string $id): void
{
    $file = event_file($id);
    if (file_exists($file)) { unlink($file); }

    $uploadDir = UPLOAD_DIR . '/' . $id;
    if (is_dir($uploadDir)) { delete_dir($uploadDir); }

    echo json_encode(['events' => array_values(load_all_events())]);
}

function events_backup(): void
{
    $stamp = gmdate('Y-m-d\TH-i-s') . 'Z';
    $dest  = BACKUP_DIR . '/backup-' . $stamp;
    mkdir($dest, 0755, true);
    foreach (glob(DATA_DIR . '/*.json') as $file) {
        copy($file, $dest . '/' . basename($file));
    }
    echo json_encode(['backup' => basename($dest)]);
}

function events_list_backups(): void
{
    $backups = [];
    foreach (glob(BACKUP_DIR . '/backup-*') as $dir) {
        if (is_dir($dir)) { $backups[] = basename($dir); }
    }
    rsort($backups);
    echo json_encode(['backups' => $backups]);
}

function events_restore(): void
{
    $body       = json_input();
    $backupName = $body['backupName'] ?? '';
    if (!$backupName) { json_error(400, 'backupName이 필요합니다.'); }

    $src = BACKUP_DIR . '/' . basename($backupName);
    if (!is_dir($src)) { json_error(404, '백업을 찾을 수 없습니다.'); }

    foreach (glob(DATA_DIR . '/*.json') as $file) { unlink($file); }
    foreach (glob($src . '/*.json') as $file) {
        copy($file, DATA_DIR . '/' . basename($file));
    }
    echo json_encode(['restored' => $backupName]);
}

function events_upload_receipt(): void
{
    $eventId   = sanitize_id($_POST['eventId'] ?? '');
    $expenseId = $_POST['expenseId'] ?? '';

    if (!$eventId || !$expenseId) {
        json_error(400, 'eventId와 expenseId가 필요합니다.');
    }
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        json_error(400, '파일이 첨부되지 않았습니다.');
    }

    $file        = $_FILES['file'];
    $allowedMime = ['image/jpeg','image/png','image/gif','image/webp','image/tiff','application/pdf'];
    $allowedExt  = ['jpg','jpeg','png','gif','webp','tif','tiff','pdf'];
    $ext         = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));

    if (!in_array($file['type'], $allowedMime, true) || !in_array($ext, $allowedExt, true)) {
        json_error(400, '허용되지 않는 파일 형식입니다. 이미지 또는 PDF만 업로드 가능합니다.');
    }
    if ($file['size'] > 8 * 1024 * 1024) {
        json_error(400, '파일 크기는 8MB를 초과할 수 없습니다.');
    }

    $targetDir = UPLOAD_DIR . '/' . $eventId;
    @mkdir($targetDir, 0755, true);

    $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', $file['name']);
    $fileName = time() . '-' . $safeName;
    $destPath = $targetDir . '/' . $fileName;

    move_uploaded_file($file['tmp_name'], $destPath);

    // 이미지 압축 (800KB 초과 시)
    if (strpos($file['type'], 'image/') === 0 && filesize($destPath) > 800 * 1024) {
        $compressed = compress_image($destPath, $eventId);
        if ($compressed !== $fileName) { $fileName = $compressed; }
    }

    $relativePath = '/uploads/' . $eventId . '/' . $fileName;
    $receiptData  = [
        'receiptName'       => $file['name'],
        'receiptPath'       => $relativePath,
        'receiptUploadedAt' => gmdate('c'),
    ];

    $event = load_event($eventId);
    if (!$event) { json_error(404, '이벤트를 찾을 수 없습니다.'); }

    $updated = null;
    foreach ($event['expenses'] as &$expense) {
        if ($expense['id'] === $expenseId) {
            $expense = array_merge($expense, $receiptData);
            $updated = $expense;
            break;
        }
    }
    unset($expense);

    if ($updated === null) { json_error(404, '지출 항목을 찾을 수 없습니다.'); }

    save_event($event);
    echo json_encode(['expense' => $updated]);
}

// ── 이미지 압축 (GD) ──────────────────────────────────────────────────

function compress_image(string $filePath, string $eventId): string
{
    if (!function_exists('imagecreatefromjpeg')) { return basename($filePath); }

    $info = @getimagesize($filePath);
    if (!$info) { return basename($filePath); }

    switch ($info['mime']) {
        case 'image/jpeg': $image = @imagecreatefromjpeg($filePath); break;
        case 'image/png':  $image = @imagecreatefrompng($filePath);  break;
        case 'image/gif':  $image = @imagecreatefromgif($filePath);  break;
        case 'image/webp': $image = @imagecreatefromwebp($filePath); break;
        default:           $image = null;
    }
    if (!$image) { return basename($filePath); }

    // 1600px 초과 시 축소
    $origW = imagesx($image);
    $origH = imagesy($image);
    if ($origW > 1600) {
        $newH    = (int)($origH * 1600 / $origW);
        $resized = imagescale($image, 1600, $newH);
        imagedestroy($image);
        $image = $resized;
    }

    $newFileName = time() . '-compressed.jpg';
    $newPath     = UPLOAD_DIR . '/' . $eventId . '/' . $newFileName;
    $quality     = 85;

    for ($i = 0; $i < 5; $i++) {
        imagejpeg($image, $newPath, $quality);
        if (filesize($newPath) <= 800 * 1024 || $quality <= 50) { break; }
        $quality -= 10;
    }

    imagedestroy($image);
    @unlink($filePath);

    return $newFileName;
}

// ── 공통 유틸 ─────────────────────────────────────────────────────────

function event_file(string $id): string
{
    return DATA_DIR . '/' . $id . '.json';
}

function load_event(string $id): ?array
{
    $file = event_file($id);
    if (!file_exists($file)) { return null; }
    $data = json_decode(file_get_contents($file), true);
    return (is_array($data) && isset($data['id'])) ? $data : null;
}

function load_all_events(): array
{
    $events = [];
    foreach (glob(DATA_DIR . '/*.json') as $file) {
        $data = json_decode(file_get_contents($file), true);
        if (is_array($data) && isset($data['id'])) { $events[] = $data; }
    }
    usort($events, function($a, $b) { return strcmp($a['name'] ?? '', $b['name'] ?? ''); });
    return $events;
}

function save_event(array $data): void
{
    file_put_contents(
        event_file($data['id']),
        json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)
    );
}

function validate_event(array $data): ?array
{
    $errors = [];
    if (empty($data['id']))                                      { $errors[] = 'id가 필요합니다.'; }
    if (empty($data['name']))                                    { $errors[] = 'name이 필요합니다.'; }
    if (!isset($data['incomes']) || !is_array($data['incomes'])) { $errors[] = 'incomes 배열이 필요합니다.'; }
    if (!isset($data['expenses']) || !is_array($data['expenses'])){ $errors[] = 'expenses 배열이 필요합니다.'; }

    foreach ($data['incomes'] ?? [] as $i => $item) {
        if (empty($item['id']))      { $errors[] = "incomes[$i].id가 필요합니다."; }
        if (!isset($item['amount'])) { $errors[] = "incomes[$i].amount가 필요합니다."; }
    }
    foreach ($data['expenses'] ?? [] as $i => $item) {
        if (empty($item['id']))      { $errors[] = "expenses[$i].id가 필요합니다."; }
        if (!isset($item['amount'])) { $errors[] = "expenses[$i].amount가 필요합니다."; }
    }

    return empty($errors) ? null : $errors;
}

function sanitize_id(string $id): string
{
    return preg_replace('/[^a-zA-Z0-9_-]/', '', $id);
}

function json_input(): array
{
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function json_error(int $code, string $message, ?array $details = null): void
{
    http_response_code($code);
    $body = ['error' => $message];
    if ($details !== null) { $body['details'] = $details; }
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function delete_dir(string $dir): void
{
    foreach (glob($dir . '/*') as $f) {
        is_dir($f) ? delete_dir($f) : unlink($f);
    }
    rmdir($dir);
}
