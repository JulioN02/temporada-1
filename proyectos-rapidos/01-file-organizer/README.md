# 01 · File Organizer

Proyecto rápido de 1–3 días de la temporada 1. Documentación en Obsidian → `Proyectos rápidos/Proyectos Rápidos.md`.

Estado: ✅ Implementado (v1)

## Documentación

- **Guía de usuario** (`docs/user-guide.md`) — requisitos, instalación/ejecución, ejemplo paso a paso, flags, configuración JSON, mapeo por defecto, casos de uso y solución de problemas.
- **Dashboard didáctico** (`docs/dashboard/index.html`) — explicación visual e interactiva del proyecto (clasificador por extensión, dry-run vs. real, colisiones, precedencia de configuración y los 5 axiomas). Se abre directo en el navegador, sin build.

## Qué hace

Organiza automáticamente los archivos de un directorio (por ejemplo `Downloads`): escanea el nivel superior, clasifica cada archivo regular por su extensión y lo mueve a una subcarpeta de categoría (`PDF/`, `Images/`, `Videos/`, `Code/`, etc.). Es seguro: nunca sobrescribe, nunca borra, es idempotente y admite un modo de ensayo (`--dry-run`) que no escribe nada.

## Uso

Ejecución nativa de TypeScript sin compilación (requiere Node 26+):

```bash
node --experimental-strip-types src/cli.ts [opciones] [directorio]
```

| Opción | Descripción |
|---|---|
| `--dry-run` | Muestra el plan sin escribir nada (ni siquiera crea carpetas) |
| `--config <ruta>` | Archivo de configuración de mayor precedencia |
| `--include-hidden` | Procesa también los archivos ocultos (punto inicial) |
| `--help` | Muestra la ayuda y termina |
| `--version` | Muestra la versión y termina |

Si no se indica directorio, se usa el directorio actual. El nombre público del binario es `file-organizer` (para `--version` y esta documentación); en v1 no se publica un `bin` porque la ejecución usa el flag nativo de Node.

### Ejemplos

```bash
# Ensayo: muestra el plan sin escribir nada
node --experimental-strip-types src/cli.ts --dry-run ~/Downloads

# Ejecución real
node --experimental-strip-types src/cli.ts ~/Downloads

# Configuración personalizada
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

## Cómo funciona por dentro

- `src/classify.ts` — clasificación pura por extensión (sin I/O, determinista)
- `src/config.ts` — mapeo por defecto, validación JSON con type guards, precedencia y fusión
- `src/mover.ts` — plan (escaneo + colisiones con sufijo) y ejecución (mkdir, `rename` con fallback EXDEV, dry-run, errores por archivo)
- `src/cli.ts` — argumentos con `util.parseArgs`, orquestación, reporte y códigos de salida
- `tests/` — tres suites `node:test` (50 tests)

Comandos de desarrollo:

```bash
npm test          # node --test (3 suites)
npm run typecheck # tsc --noEmit
```

## Preguntas guía

### 1. ¿Qué problema resuelve?

La carpeta de descargas acumula archivos desordenados y encontrarlos se vuelve lento. Una regla simple de clasificación por extensión lo automatiza: un comando mueve cada archivo a su carpeta de categoría de forma segura, con modo de ensayo y configuración declarativa por directorio.

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