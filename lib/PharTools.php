<?php
declare(strict_types=1);

namespace PharForge;

final class PharTools {

    public static function extractZip(string $zipFile, string $destDir): void {
        $zip = new \ZipArchive();
        if ($zip->open($zipFile) !== true) {
            throw new \RuntimeException("No se pudo abrir el zip.");
        }
        $zip->extractTo($destDir);
        $zip->close();
    }

    public static function extractPhar(string $pharFile, string $destDir): void {
        $phar = new \Phar($pharFile);
        $phar->extractTo($destDir, null, true);
    }

    public static function zipDir(string $dir, string $zipFile): void {
        $zip = new \ZipArchive();
        if ($zip->open($zipFile, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException("No se pudo crear el zip.");
        }
        $base = rtrim($dir, '/\\');
        $rii = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS)
        );
        foreach ($rii as $file) {
            if ($file->isFile()) {
                $real = str_replace('\\', '/', $file->getPathname());
                $rel = substr($real, strlen($base) + 1);
                $zip->addFile($real, $rel);
            }
        }
        $zip->close();
    }

    public static function resolveRoot(string $dir): string {
        $entries = array_values(array_diff(scandir($dir) ?: [], ['.', '..']));
        if (count($entries) === 1 && is_dir($dir . '/' . $entries[0])) {
            return $dir . '/' . $entries[0];
        }
        return $dir;
    }

    public static function findPluginName(string $rootDir): ?string {
        $pluginYml = $rootDir . '/plugin.yml';
        if (!is_file($pluginYml)) {
            return null;
        }
        $content = file_get_contents($pluginYml);
        if ($content !== false && preg_match('/^name:\s*(.+)$/mi', $content, $m)) {
            return trim($m[1], " \t\"'");
        }
        return null;
    }

    public static function buildPhar(string $rootDir, string $outFile, string $pluginName, string $version, int $compression = \Phar::NONE, bool $obfuscate = false): void {
        if (file_exists($outFile)) {
            unlink($outFile);
        }

        $phar = new \Phar($outFile);
        $phar->startBuffering();
        $stub = "<?php echo 'PocketMine-MP plugin {$pluginName} v{$version}" . '\n'
            . "This file must not be used as a PHP script.\\n\"; __HALT_COMPILER(); ?>";
        $phar->setStub($stub);

        $rii = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($rootDir, \FilesystemIterator::SKIP_DOTS)
        );

        $skipDirs = ['.git', '.github', 'node_modules', '.idea', '.vscode'];

        foreach ($rii as $file) {
            if (!$file->isFile()) {
                continue;
            }
            $real = str_replace('\\', '/', $file->getPathname());
            $rel = substr($real, strlen(rtrim($rootDir, '/\\')) + 1);

            $skip = false;
            foreach ($skipDirs as $sd) {
                if (str_starts_with($rel, $sd . '/')) {
                    $skip = true;
                    break;
                }
            }
            if ($skip) {
                continue;
            }

            if ($obfuscate && str_ends_with($rel, '.php')) {
                $phar->addFromString($rel, self::stripComments(file_get_contents($real)));
            } else {
                $phar->addFile($real, $rel);
            }
        }

        if ($compression !== \Phar::NONE) {
            $phar->compressFiles($compression);
        }

        $phar->stopBuffering();
    }

    public static function stripComments(string $source): string {
        $tokens = token_get_all($source);
        $out = '';
        $prevWasWhitespace = false;

        foreach ($tokens as $token) {
            if (is_array($token)) {
                [$id, $text] = $token;
                if ($id === T_COMMENT || $id === T_DOC_COMMENT) {
                    continue;
                }
                if ($id === T_WHITESPACE) {
                    if ($prevWasWhitespace) {
                        continue;
                    }
                    $out .= ' ';
                    $prevWasWhitespace = true;
                    continue;
                }
                $out .= $text;
                $prevWasWhitespace = false;
            } else {
                $out .= $token;
                $prevWasWhitespace = false;
            }
        }

        return $out;
    }

    public static function rrmdir(string $dir): void {
        if (!is_dir($dir)) {
            return;
        }
        $items = scandir($dir) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . '/' . $item;
            if (is_dir($path) && !is_link($path)) {
                self::rrmdir($path);
            } else {
                unlink($path);
            }
        }
        rmdir($dir);
    }

    public static function humanSize(int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        $size = (float)$bytes;
        while ($size >= 1024 && $i < count($units) - 1) {
            $size /= 1024;
            $i++;
        }
        return round($size, 2) . ' ' . $units[$i];
    }
}
