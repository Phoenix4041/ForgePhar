# ForgePhar

Herramienta web para descomprimir, compilar y proteger plugins `.phar` de PocketMine-MP. Corre 100% en el navegador: nada se sube a un servidor, el procesamiento entero pasa en JavaScript local.

## Que hace

- **Descomprimir**: sube un `.phar` o `.zip` y obten su contenido extraido en un `.zip`, con el arbol de archivos.
- **Generar .phar**: sube el `.zip` de tu plugin (debe contener `plugin.yml` en la raiz) y obten el `.phar` compilado, firmado con SHA-1, listo para el servidor.
- **Proteger .phar**: igual que generar, pero ademas comprime cada archivo con el mismo formato GZIP por-entrada que usa `Phar::compressFiles()` en PHP, y elimina comentarios/espacios superfluos del codigo. El resultado deja de ser texto plano legible si alguien abre el archivo con un editor de texto o un zip generico.

No implementa cifrado irreversible tipo ionCube o SourceGuardian: eso requiere una extension de bytecode compilada en el servidor donde corre el plugin, y romper esa cadena de confianza tumbaria la ejecucion en PocketMine. Lo que si ofrece es proteccion real contra lectura casual del codigo fuente.

## Como funciona

`docs/js/pharlib.js` reimplementa el formato binario `.phar` de PHP en JavaScript puro: manifest, compresion GZIP por entrada (deflate raw, igual que PHP), firma SHA-1 y verificacion de `__HALT_COMPILER();`. Se valido byte a byte contra la extension `Phar` real de PHP: los archivos que genera ForgePhar en el navegador se leen y ejecutan sin diferencias en un servidor PHP/PocketMine real.

Usa dos librerias vendorizadas en `docs/vendor/`:
- **pako** para deflate/inflate raw (compresion GZIP por entrada).
- **JSZip** para leer y escribir `.zip`.

## Uso local

Al ser un sitio estatico, cualquier servidor HTTP simple sirve:

```bash
python -m http.server 8080 -d public
```

Abre `http://localhost:8080`. `crypto.subtle` (usado para firmar el `.phar`) requiere un contexto seguro: `https://` o `localhost` funcionan, abrir el `index.html` directamente con `file://` no.

## Estructura

```
docs/index.html      Interfaz
docs/js/main.js       Logica de UI (subida de archivos, llamadas a pharlib)
docs/js/pharlib.js    Lectura/escritura del formato .phar, sin dependencias
docs/vendor/          pako y JSZip vendorizados
docs/style.css        Estilos
```

## Licencia

MIT — ver [LICENSE](LICENSE).

**Made with ❤️ by Phoenix4041**
