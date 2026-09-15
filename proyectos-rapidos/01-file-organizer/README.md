# 01 · File Organizer

Un CLI para ordenar el nivel superior de un directorio por extensión de archivo: clasificación, `--dry-run`, colisiones seguras e idempotencia — con cero dependencias de runtime.

Estado: ✅ Entregado · 50/50 tests · typecheck limpio · cero dependencias

Proyecto rápido de la temporada 1 (sección **Proyectos**). Documentación en Obsidian → `Temporada 1/Proyectos rápidos/01 File Organizer.md` (nota general) y `01 File Organizer — Ficha Técnica.md` (ficha técnica).

## Demo en vivo

- **Dashboard interactivo (GitHub Pages):** <https://julion02.github.io/file-organizer/dashboard/>
- **Repositorio:** <https://github.com/JulioN02/file-organizer>

La demo corre en el navegador sin build ni dependencias externas: simulador de clasificación, dry-run vs. ejecución real, resolución de colisiones y precedencia de configuración.

## El problema

La carpeta de descargas acumula archivos desordenados y encontrarlos se vuelve lento. Una regla simple de clasificación por extensión lo automatiza: un comando escanea el nivel superior, clasifica cada archivo regular por su extensión y lo mueve a una subcarpeta de categoría (`PDF/`, `Images/`, `Videos/`, `Code/`, …).

La solución es **segura por diseño**: nunca sobrescribe, nunca borra, es idempotente y admite un modo de ensayo (`--dry-run`) que no escribe nada.

## Instalación y ejecución

Requisito: **Node.js >= 26** (por la ejecución nativa de TypeScript con `--experimental-strip-types`, sin paso de build).

```bash
npm install          # solo devDependencies (@types/node, typescript)
npm test             # node --test (3 suites)
npm run typecheck    # tsc --noEmit
```

Ejecución directa desde el código fuente:

```bash
node --experimental-strip-types src/cli.ts [opciones] [directorio]
```

Si no se indica directorio, se usa el directorio actual. El nombre público del binario es `file-organizer` (para `--version` y esta documentación); en v1 no se publica un `bin` porque la ejecución usa el flag nativo de Node.

## Uso

### Ejemplo real

```bash
# 1. Ensayo: muestra el plan sin escribir nada
node --experimental-strip-types src/cli.ts --dry-run ~/Downloads

# 2. Ejecución real
node --experimental-strip-types src/cli.ts ~/Downloads

# 3. Configuración personalizada
node --experimental-strip-types src/cli.ts --config ./mi-config.json ~/Downloads
```

Salida de ejemplo (stdout):

```
Moved: 3 | Skipped: 2 | Errors: 0
PDF/report.pdf ← report.pdf
Images/photo.png ← photo.png
skipped: .env (hidden)
skipped: data.bin (misc omitted)
```

En modo `--dry-run` todas las líneas de stdout llevan el prefijo `[dry-run]`. Los errores se escriben en stderr y el código de salida es `1` si hubo algún error; en caso contrario, `0`.

### Tabla de opciones

| Opción | Descripción |
|---|---|
| `--dry-run` | Muestra el plan sin escribir nada (ni siquiera crea carpetas) |
| `--config <ruta>` | Archivo de configuración de mayor precedencia |
| `--include-hidden` | Procesa también los archivos ocultos (punto inicial) |
| `--help` | Muestra la ayuda y termina |
| `--version` | Muestra la versión y termina |

## Configuración

Archivo JSON con tres claves opcionales:

```json
{
  "mapping": { "pdf": "PDF", "py": "Python" },
  "miscFolder": "Otros",
  "omitMisc": false
}
```

- `mapping`: extensión → categoría. Las claves se normalizan a minúsculas y sin punto inicial; los valores deben ser texto no vacío. El mapeo se **fusiona por extensión** con los valores por defecto: una clave presente sobrescribe el valor por defecto de esa extensión y una clave nueva lo extiende (en v1 no existe mecanismo para eliminar claves por defecto).
- `miscFolder`: carpeta para extensiones desconocidas o archivos sin extensión (por defecto `Others`).
- `omitMisc`: si es `true`, los archivos misceláneos no se mueven y se reportan como omitidos.

### Precedencia

La configuración activa se resuelve de menor a mayor precedencia:

1. Valores por defecto embebidos
2. `<cwd>/.file-organizer.json` (si existe)
3. `<target>/.file-organizer.json` (si existe)
4. `--config <ruta>` (debe existir)

La capa superior gana en caso de conflicto y el `mapping` se fusiona por extensión en cada capa. Un JSON malformado, claves desconocidas o valores incorrectos producen un error fatal en stderr con código de salida 1 (nunca un fallback silencioso a los valores por defecto).

### Lista de ignorados

Todos los archivos de configuración cargados en la ejecución (el de `--config` y los `.file-organizer.json` del directorio y del cwd) se añaden a la lista de ignorados: nunca se mueven, aunque su extensión tenga categoría. Los directorios, los archivos ocultos (salvo con `--include-hidden`) y los enlaces simbólicos tampoco se procesan. Ejecutar el organizador dos veces seguidas produce cero movimientos en la segunda ejecución (idempotencia).

## Módulos / arquitectura

| Módulo | Rol |
|---|---|
| `src/classify.ts` | Clasificación pura por extensión (sin I/O, determinista) |
| `src/config.ts` | Mapeo por defecto, validación JSON con type guards, precedencia y fusión |
| `src/mover.ts` | Plan (escaneo + colisiones con sufijo) y ejecución (mkdir, `rename` con fallback EXDEV, dry-run, errores por archivo) |
| `src/cli.ts` | Argumentos con `util.parseArgs`, orquestación, reporte y códigos de salida |
| `tests/` | Tres suites `node:test` (50 tests) |

## Axiomas

1. **Categoría solo desde la extensión** — la clasificación depende únicamente del nombre y el mapeo activo; misma entrada, misma salida.
2. **Solo archivos regulares del nivel superior** — nunca se mueven directorios, archivos ocultos (salvo `--include-hidden`) ni enlaces simbólicos.
3. **Nunca se sobrescribe ni se pierde data** — las colisiones se resuelven con sufijo determinista; un destino que no puede verificarse se asume ocupado.
4. **Idempotencia** — ejecutar dos veces seguidas mueve cero archivos en la segunda pasada.
5. **Desconocido o sin extensión → `Others` u omitir, nunca borrar** — con `omitMisc: true` se reportan como omitidos, jamás se eliminan.

## Evidencia

- **Tests:** 50/50 en verde (`node --test`, suites classify / config / mover).
- **Typecheck:** `tsc --noEmit` limpio.
- **Capturas reales del CLI:** `docs/evidence/` — cada archivo es la salida capturada del comando real contra directorios temporales (help, versión, dry-run, ejecución real, idempotencia, colisiones, configuración por capas, archivos ocultos, errores y suite de tests).

## Documentación

- **Guía de usuario** (`docs/user-guide.md`) — requisitos, instalación/ejecución, ejemplo paso a paso, flags, configuración JSON, mapeo por defecto, casos de uso y solución de problemas.
- **Dashboard interactivo en vivo** — [github.com/JulioN02/file-organizer → dashboard](https://julion02.github.io/file-organizer/dashboard/): explicación visual del proyecto con un **terminal interactivo** (escribe comandos del CLI y ve la salida real simulada), simulaciones de clasificador, colisiones y precedencia, y una **guía rápida** de instalación y uso. Fuente: `docs/dashboard/` (index.html + app.js + style.css) en HTML/CSS/JS puro, sin CDN ni build. `docs/index.html` redirige a la demo desde la raíz de GitHub Pages.
- **Ficha de portafolio** (`docs/PORTFOLIO.md`) — versión divulgativa para la sección Proyectos (por qué CLI, diseño de ingeniería, evidencia, links).
- **Obsidian:** nota general `Temporada 1/Proyectos rápidos/01 File Organizer.md` · ficha técnica `01 File Organizer — Ficha Técnica.md`.

## Preguntas guía

### 1. ¿Qué problema resuelve?

El problema descrito arriba: una carpeta de descargas desordenada donde encontrar un archivo es lento. Lo que se aprendió: automatizarlo con una regla simple de clasificación por extensión — un comando mueve cada archivo a su carpeta de categoría de forma segura, con modo de ensayo y configuración declarativa por directorio.

### 2. ¿Qué aprendí?

- Filesystem: `readdir` con `withFileTypes` para distinguir archivos, directorios y symlinks sin `stat` adicional; `rename` como operación atómica; `mkdir` recursivo.
- Streams: `stream/promises.pipeline` como fallback cross-device (EXDEV) para copiar sin cargar el archivo completo en memoria.
- CLI: `util.parseArgs` en modo estricto, posicionales, flags, stdout/stderr separados y códigos de salida.
- Configuración declarativa: precedencia en capas, merge por extensión y validación con type guards sobre `unknown` (sin `any`).
- Diseño: separar plan (lectura pura) de ejecución (escrituras) habilita el dry-run sin efectos y reportes deterministas.
- TypeScript nativo con `node --experimental-strip-types` (sin paso de build) y TDD estricto con `node:test` (RED → GREEN → triangulación).

### 3. ¿Qué parte fue difícil?

- Simular EXDEV sin un mount cross-device: se resolvió con un seam de test (`MoveDeps`) que inyecta `rename`/`copy`/`unlink`; en producción nunca se inyecta.
- Las colisiones intra-plan: dos archivos de la raíz pueden terminar queriendo el mismo destino; el conjunto de reservas del plan es obligatorio para no sobrescribir entre movimientos del mismo plan.
- Las carreras TOCTOU: un archivo puede desaparecer entre el escaneo y el movimiento; hay que re-chequear el destino y reportar el error sin detener el resto.
- Un caso sutil: si una carpeta de categoría es en realidad un archivo, `stat` lanza `ENOTDIR` (no `ENOENT`) y sin tratarlo el resolutor de colisiones entraba en un bucle infinito; lo descubrió un test que colgaba.

### 4. ¿Qué haría diferente?

- Añadiría recursividad (`--recursive`) y quizá un módulo MIME para clasificar por contenido cuando la extensión no baste.
- El `miscFolder` podría aceptar rutas anidadas (hoy solo un nombre de carpeta).
- Una suite dedicada para el CLI (hoy se verifica con secuencias de smoke documentadas) usando `spawn` real.
- Publicaría un `bin` cuando la ejecución nativa de TypeScript se estabilice sin flags experimentales.

## Licencia

[Apache-2.0](LICENSE) — © 2026 JulioN02. Puedes usar, copiar, modificar y distribuir el proyecto libremente, siempre que conserves el aviso de licencia y atribución del autor original.