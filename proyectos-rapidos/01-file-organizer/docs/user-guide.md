# 01 · File Organizer — Guía de usuario

> Proyecto rápido de la temporada 1 · CLI en Node/TypeScript que organiza automáticamente los
> archivos de un directorio por su extensión.
> Complementa el `README.md` (introducción) y el dashboard didáctico (`docs/dashboard/index.html`).

---

## 1. Requisitos

- **Node.js 26 o superior** — el proyecto se ejecuta con TypeScript nativo sin compilación, usando el
  flag `--experimental-strip-types`.
- Solo herramientas de desarrollo: `typescript` y `@types/node` (devDependencies). **Cero
  dependencias en runtime.**

## 2. Instalación y ejecución

No hay paso de build ni paquete publicado en v1. Se ejecuta directo sobre el código fuente:

```bash
# Desde la carpeta del proyecto
node --experimental-strip-types src/cli.ts [opciones] [directorio]
```

- `directorio` es opcional; si se omite, se organiza el **directorio actual**.
- El nombre público del binario es `file-organizer` (aparece en `--version` y en la ayuda).
- Comandos de desarrollo disponibles en `package.json`:
  ```bash
  npm start          # node --experimental-strip-types src/cli.ts
  npm test           # node --test (3 suites, 50 tests)
  npm run typecheck  # tsc --noEmit
  ```

## 3. Ejemplo rápido, paso a paso

Crear un directorio de prueba con algunos archivos de ejemplo:

```bash
mkdir -p /tmp/ordenar && cd /tmp/ordenar
touch report.pdf foto.png script.py datos.bin .env
```

**Paso 1 — Ensayar sin escribir nada:**

```bash
node /ruta/al/proyecto/src/cli.ts --dry-run
```

Salida esperada (stdout, todo con el prefijo `[dry-run]`):

```
[dry-run] Moved: 4 | Skipped: 1 | Errors: 0
[dry-run] Others/datos.bin ← datos.bin
[dry-run] Images/foto.png ← foto.png
[dry-run] PDF/report.pdf ← report.pdf
[dry-run] Code/script.py ← script.py
[dry-run] skipped: .env (hidden)
```

Verifica que el plan tiene sentido: `report.pdf` → `PDF/`, `foto.png` → `Images/`,
`script.py` → `Code/`, `datos.bin` (extensión sin mapear) → `Others/`, y `.env` se **omite** por ser
archivo oculto. Nada se escribió todavía.

**Paso 2 — Ejecutar la corrida real:**

```bash
node /ruta/al/proyecto/src/cli.ts
```

Ahora sí se crean las carpetas (`PDF/`, `Images/`, `Code/`, `Others/`) y se mueven los archivos. El
reporte es el mismo, sin el prefijo `[dry-run]`.

**Paso 3 — Verificar la idempotencia:**

```bash
node /ruta/al/proyecto/src/cli.ts
```

La segunda corrida reporta **cero movimientos**: `Moved: 0 | Skipped: 0 | Errors: 0` (todo lo
clasificable ya está en su carpeta).

## 4. Flags del CLI

| Flag | Descripción |
|---|---|
| `--dry-run` | Muestra el plan sin escribir nada. Ni siquiera crea carpetas (`mkdir`). |
| `--config <ruta>` | Archivo de configuración JSON de mayor precedencia. **Debe existir**; si no, error fatal. |
| `--include-hidden` | Procesa también los archivos ocultos (los que empiezan con `.`). |
| `--help` | Muestra la ayuda y termina con código `0`. |
| `--version` | Muestra la versión y termina con código `0`. |

Ejemplos:

```bash
node --experimental-strip-types src/cli.ts --dry-run ~/Downloads
node --experimental-strip-types src/cli.ts ~/Downloads
node --experimental-strip-types src/cli.ts --config ./mi-config.json ~/Downloads
node --experimental-strip-types src/cli.ts --include-hidden --dry-run .
```

## 5. Archivo de configuración JSON

Un JSON con hasta tres claves opcionales:

```json
{
  "mapping": { "pdf": "PDF", "py": "Python" },
  "miscFolder": "Otros",
  "omitMisc": false
}
```

| Clave | Tipo | Descripción |
|---|---|---|
| `mapping` | objeto `{extensión: categoría}` | Extensión → carpeta. Las claves se normalizan (minúsculas, sin punto inicial). El mapeo se **fusiona por extensión** con los valores por defecto: una clave presente sobrescribe el valor de esa extensión; una clave nueva lo extiende. En v1 no hay mecanismo para eliminar claves por defecto. |
| `miscFolder` | string | Carpeta para extensiones desconocidas o archivos sin extensión (por defecto `Others`). Solo un nombre de carpeta, sin separadores de ruta. |
| `omitMisc` | boolean | Si es `true`, los archivos misceláneos **no se mueven** y se reportan como omitidos (`skipped: … (misc omitted)`). |

La precedencia de capas y la lista de archivos ignorados se explican en el README del proyecto (§Configuración).

## 6. Mapeo por defecto (extensión → categoría)

| Categoría | Extensiones |
|---|---|
| `PDF` | `pdf` |
| `Images` | `jpg` `jpeg` `png` `gif` `webp` `svg` `bmp` `ico` `avif` |
| `Videos` | `mp4` `mkv` `avi` `mov` `webm` `m4v` |
| `Audio` | `mp3` `wav` `flac` `ogg` `m4a` `aac` `opus` |
| `Code` | `ts` `js` `tsx` `jsx` `py` `rs` `go` `java` `c` `cpp` `h` `hpp` `sh` `json` `yml` `yaml` `toml` `html` `css` `scss` |
| `Documents` | `doc` `docx` `xls` `xlsx` `ppt` `pptx` `odt` `ods` `txt` `md` `rtf` `csv` |
| `Archives` | `zip` `tar` `gz` `bz2` `xz` `7z` `rar` `tgz` `deb` `rpm` `iso` |

Cualquier otra extensión, o un archivo sin extensión (`LICENSE`) o con punto inicial (`.env`), va a
`miscFolder` (`Others` por defecto) o se omite con `omitMisc: true`.

## 7. Casos de uso reales

- **Organizar `~/Downloads`** tras semanas de descargas:
  ```bash
  node --experimental-strip-types src/cli.ts --dry-run ~/Downloads   # revisar
  node --experimental-strip-types src/cli.ts ~/Downloads             # ejecutar
  ```
- **Configuración por directorio**: colocar un `.file-organizer.json` en `~/Downloads` (o en tu
  carpeta actual) para que cada carpeta tenga sus propias reglas sin flags.
- **Mantener a raya los archivos ocultos**: por defecto no se tocan; con `--include-hidden`
  también se clasifican (y, al no tener extensión, caen en la carpeta miscelánea).

## 8. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `error: cannot access target directory …` | El directorio destino no existe o no es accesible; código `1`. |
| `error: <ruta> is not a directory` | Pasaste un archivo como directorio destino; código `1`. |
| `error: <ruta>: cannot read config file` | `--config <ruta>` no existe (es obligatorio); código `1`. |
| `error: <ruta>: invalid JSON` | El archivo de configuración no es JSON válido; corrígelo y reintenta. |
| `error: <ruta>: unknown top-level key "…"` | Solo se admiten `mapping`, `miscFolder`, `omitMisc`. |
| `error: …: mapping[..] must be a non-empty string` | Los valores de `mapping` deben ser texto no vacío. |
| `error: expected at most one target directory argument` | Se pasaron dos directorios; el CLI acepta uno solo. |
| Código de salida `1` | Hubo al menos un error (configuración o movimiento por archivo). `0` = todo bien. |
| Un archivo no se mueve pero aparece `skipped` | Es oculto, directorio, symlink, un archivo de configuración, o misceláneo con `omitMisc: true`. Es comportamiento esperado. |

**Consejos:**

- Siempre prueba con `--dry-run` antes de una corrida real.
- Si una carpeta de categoría es en realidad un archivo, el organizador lo detecta sin entrar en
  bucle (`ENOTDIR` se trata como destino no existente).
- El reporte va a **stdout**; los errores van a **stderr**; los códigos de salida son `0`/`1`.

## 9. Preguntas guía

Las 4 preguntas guía (problema, aprendizajes, dificultades, mejoras) están en el `README.md` del proyecto.

---

**Ver también:** `README.md` (introducción y configuración) · `docs/dashboard/index.html`
(dashboard didáctico e interactivo).