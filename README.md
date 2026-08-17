# ForgePhar

Herramienta web local para descomprimir, compilar y proteger plugins `.phar` de PocketMine-MP. Corre 100% en tu máquina: no sube nada a internet, no depende de servicios externos.

## Qué hace

- **Descomprimir**: sube un `.phar` o `.zip` y obtén su contenido extraído en un `.zip`, con el árbol de archivos.
- **Generar .phar**: sube el `.zip` de tu plugin (debe contener `plugin.yml` en la raíz) y obtén el `.phar` compilado, listo para el servidor.
- **Proteger .phar**: igual que generar, pero además compila con compresión GZIP nativa de `Phar` y elimina comentarios/espacios superfluos del código PHP. El resultado deja de ser texto plano legible a simple vista si alguien abre el archivo con un editor de texto o un zip genérico.

No implementa cifrado irreversible tipo ionCube o SourceGuardian: eso requiere una extensión de bytecode compilada en el servidor donde corre el plugin, y romper esa cadena de confianza tumbaría la ejecución en PocketMine. Lo que sí ofrece es protección real contra lectura casual del código fuente.

## Requisitos

- PHP 8.1 o superior, con las extensiones `phar` y `zip` habilitadas.

## Uso

```bash
php -d phar.readonly=0 -S localhost:8090 -t public
```

Abre `http://localhost:8090` en tu navegador.

`phar.readonly=0` es necesario porque, por defecto, PHP no permite crear ni modificar archivos `.phar` desde código.

## Estructura

```
lib/PharTools.php   Lógica de extracción, compilación y compresión (Phar, ZipArchive)
public/index.html   Interfaz
public/app.js        Lógica de frontend (subida de archivos, llamadas a la API)
public/api.php       Endpoints: extract, build, protect, download
uploads/              Archivos temporales de subida (se limpian automáticamente tras 1 hora)
output/               Archivos generados listos para descargar (se limpian automáticamente tras 1 hora)
```

## Licencia

MIT — ver [LICENSE](LICENSE).
