<?php
declare(strict_types=1);

require __DIR__ . '/../lib/PharTools.php';

use PharForge\PharTools;

header('X-Content-Type-Options: nosniff');

$ROOT = dirname(__DIR__);
$UPLOADS = $ROOT . '/uploads';
$OUTPUT = $ROOT . '/output';

foreach ([$UPLOADS, $OUTPUT] as $d) {
    if (!is_dir($d)) {
        mkdir($d, 0777, true);
    }
}

function jsonOut(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function cleanupOld(string $dir, int $maxAgeSeconds = 3600): void {
    foreach (glob($dir . '/*') ?: [] as $path) {
        if (is_file($path) && time() - filemtime($path) > $maxAgeSeconds) {
            @unlink($path);
        } elseif (is_dir($path) && time() - filemtime($path) > $maxAgeSeconds) {
            PharTools::rrmdir($path);
        }
    }
}

cleanupOld($UPLOADS);
cleanupOld($OUTPUT);

$action = $_GET['action'] ?? '';

try {
    switch ($action) {

        case 'download': {
            $token = $_GET['token'] ?? '';
            if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
                jsonOut(['ok' => false, 'error' => 'Token inválido.'], 400);
            }
            $meta = $OUTPUT . '/' . $token . '.meta.json';
            if (!is_file($meta)) {
                jsonOut(['ok' => false, 'error' => 'Archivo no encontrado o expirado.'], 404);
            }
            $info = json_decode(file_get_contents($meta), true);
            $filePath = $OUTPUT . '/' . $token . '_' . $info['filename'];
            if (!is_file($filePath)) {
                jsonOut(['ok' => false, 'error' => 'Archivo no encontrado.'], 404);
            }
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . $info['filename'] . '"');
            header('Content-Length: ' . filesize($filePath));
            readfile($filePath);
            exit;
        }

        case 'extract': {
            if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                jsonOut(['ok' => false, 'error' => 'No se recibió ningún archivo.'], 400);
            }
            $orig = $_FILES['file']['name'];
            $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
            $token = bin2hex(random_bytes(16));
            $workDir = $UPLOADS . '/' . $token;
            mkdir($workDir, 0777, true);

            $uploadedPath = $workDir . '/upload.' . $ext;
            move_uploaded_file($_FILES['file']['tmp_name'], $uploadedPath);

            $destDir = $workDir . '/extracted';
            mkdir($destDir, 0777, true);

            if ($ext === 'phar') {
                PharTools::extractPhar($uploadedPath, $destDir);
            } elseif ($ext === 'zip') {
                PharTools::extractZip($uploadedPath, $destDir);
            } else {
                jsonOut(['ok' => false, 'error' => 'Formato no soportado. Usa .phar o .zip'], 400);
            }

            $baseName = pathinfo($orig, PATHINFO_FILENAME);
            $zipOut = $OUTPUT . '/' . $token . '_' . $baseName . '_extraido.zip';
            PharTools::zipDir($destDir, $zipOut);

            $filename = $baseName . '_extraido.zip';
            file_put_contents($OUTPUT . '/' . $token . '.meta.json', json_encode(['filename' => $filename]));

            $tree = buildTree($destDir);
            PharTools::rrmdir($workDir);

            jsonOut([
                'ok' => true,
                'token' => $token,
                'filename' => $filename,
                'size' => PharTools::humanSize(filesize($zipOut)),
                'tree' => $tree,
            ]);
        }

        case 'build':
        case 'protect': {
            if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                jsonOut(['ok' => false, 'error' => 'No se recibió ningún archivo.'], 400);
            }
            $ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
            if ($ext !== 'zip') {
                jsonOut(['ok' => false, 'error' => 'Sube un .zip con la carpeta del plugin (debe contener plugin.yml).'], 400);
            }

            $token = bin2hex(random_bytes(16));
            $workDir = $UPLOADS . '/' . $token;
            mkdir($workDir, 0777, true);
            $zipPath = $workDir . '/upload.zip';
            move_uploaded_file($_FILES['file']['tmp_name'], $zipPath);

            $extractDir = $workDir . '/src';
            mkdir($extractDir, 0777, true);
            PharTools::extractZip($zipPath, $extractDir);
            $root = PharTools::resolveRoot($extractDir);

            if (!is_file($root . '/plugin.yml')) {
                PharTools::rrmdir($workDir);
                jsonOut(['ok' => false, 'error' => 'No se encontró plugin.yml en el zip subido.'], 400);
            }

            $pluginName = $_POST['pluginName'] ?? PharTools::findPluginName($root) ?? 'Plugin';
            $version = $_POST['version'] ?? '1.0.0';
            $pluginName = preg_replace('/[^A-Za-z0-9_\-]/', '', $pluginName) ?: 'Plugin';

            $protect = $action === 'protect';
            $compression = $protect ? Phar::GZ : Phar::NONE;

            $outFile = $OUTPUT . '/' . $token . '_' . $pluginName . '.phar';
            try {
                PharTools::buildPhar($root, $outFile, $pluginName, $version, $compression, $protect);
            } catch (\Throwable $e) {
                if (str_contains($e->getMessage(), 'zlib')) {
                    PharTools::buildPhar($root, $outFile, $pluginName, $version, Phar::NONE, $protect);
                } else {
                    throw $e;
                }
            }

            $filename = $pluginName . '.phar';
            file_put_contents($OUTPUT . '/' . $token . '.meta.json', json_encode(['filename' => $filename]));
            PharTools::rrmdir($workDir);

            jsonOut([
                'ok' => true,
                'token' => $token,
                'filename' => $filename,
                'size' => PharTools::humanSize(filesize($outFile)),
                'protected' => $protect,
            ]);
        }

        default:
            jsonOut(['ok' => false, 'error' => 'Acción desconocida.'], 400);
    }
} catch (\Throwable $e) {
    jsonOut(['ok' => false, 'error' => $e->getMessage()], 500);
}

function buildTree(string $dir, int $limit = 500): array {
    $out = [];
    $count = 0;
    $base = rtrim($dir, '/\\');
    $rii = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($rii as $file) {
        if ($count >= $limit) {
            $out[] = '… (más archivos)';
            break;
        }
        if ($file->isFile()) {
            $real = str_replace('\\', '/', $file->getPathname());
            $out[] = substr($real, strlen($base) + 1);
            $count++;
        }
    }
    sort($out);
    return $out;
}
