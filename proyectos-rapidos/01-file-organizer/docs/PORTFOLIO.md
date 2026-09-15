# File Organizer — CLI para ordenar archivos por extensión

**Un comando, un directorio ordenado.** File Organizer es un CLI didáctico en TypeScript/Node que organiza el nivel superior de un directorio (por ejemplo `~/Downloads`): escanea, clasifica cada archivo regular por su extensión y lo mueve a una subcarpeta de categoría (`PDF/`, `Images/`, `Videos/`, `Code/`, …). Es seguro por diseño — modo de ensayo (`--dry-run`) que no escribe nada, resolución de colisiones sin sobrescribir e idempotencia — con cero dependencias de runtime y 50/50 tests en verde.

## Por qué CLI

| Forma | Ventaja | Costo |
| --- | --- | --- |
| GUI | Amigable | No automatizable, no componible |
| Librería | Reutilizable en código | El usuario final no la usa |
| **CLI** | **Automatizable** (scripts/CI), **componible** (pipes), universal | Exige respetar el contrato de texto |

La tarea es una operación de mantenimiento repetible: un humano la lanza manualmente y un script puede programarla. El CLI es la única forma que sirve para ambos, con un contrato de texto estable (stdout = reporte, stderr = errores, exit `0`/`1`).

## Qué hace

- **Clasificación por extensión:** cada archivo regular del nivel superior se mueve a su carpeta de categoría según un mapeo extensión → categoría (embebido y extensible por configuración).
- **Modo de ensayo (`--dry-run`):** muestra el plan completo sin escribir nada — ni siquiera crea carpetas; todas las líneas llevan el prefijo `[dry-run]`.
- **Colisiones seguras:** si el destino ya existe, se genera un nombre determinista con sufijo (`report (1).pdf`, `report (2).pdf`, …). Nunca sobrescribe.
- **Idempotencia:** ejecutar dos veces seguidas mueve cero archivos en la segunda pasada.
- **Configuración por capas:** `--config` > `<target>/.file-organizer.json` > `<cwd>/.file-organizer.json` > valores por defecto, con fusión del mapeo por extensión.
- **Archivos ocultos:** se omiten por defecto; `--include-hidden` los procesa.

## Diseño de ingeniería

- **5 axiomas:** (1) la categoría se deriva únicamente de la extensión; (2) solo se procesan archivos regulares del nivel superior (nunca directorios, ocultos salvo flag, ni symlinks); (3) nunca se sobrescribe ni se pierde data; (4) idempotencia; (5) los desconocidos/sin extensión van a `Others` o se omiten — nunca se borran.
- **Cero dependencias de runtime:** solo las APIs nativas de Node (`node:util.parseArgs`, `node:fs`, `node:stream`). TypeScript nativo con `node --experimental-strip-types` (sin paso de build).
- **Config por capas con precedencia:** la capa superior gana por clave; el `mapping` se fusiona por extensión en cada capa; un JSON malformado o con claves desconocidas es error fatal (exit 1), nunca fallback silencioso.
- **Plan separado de ejecución:** el escaneo y la resolución de colisiones son lectura pura (deterministas, orden lexicográfico); la ejecución escribe. Esto habilita el dry-run sin efectos y reportes estables.
- **`rename` con fallback EXDEV:** un `rename` que falla por cruce de dispositivo se resuelve copiando con `stream/promises.pipeline` (memoria acotada) y borrando el origen; una copia parcial se limpia y el error se reporta.
- **Dry-run como salvaguarda:** garantizado a nivel de ejecución (cero escrituras, ni `mkdir`), no solo prometido en la documentación.
- **Resiliencia por archivo:** un fallo (TOCTOU, permiso, destino inesperado) se reporta en stderr y no detiene el resto de movimientos.

## Stack

TypeScript (ESM) · Node.js >= 26 · cero dependencias de runtime · `node:test` (TDD estricto, 3 suites) · `tsc --noEmit` para typecheck

## Ejemplos rápidos

```bash
# Ensayo: muestra el plan sin escribir nada
node --experimental-strip-types src/cli.ts --dry-run ~/Downloads

# Ejecución real: mueve cada archivo a su carpeta de categoría
node --experimental-strip-types src/cli.ts ~/Downloads

# Configuración personalizada por directorio (.file-organizer.json)
node --experimental-strip-types src/cli.ts ~/Downloads

# Configuración explícita de mayor precedencia
node --experimental-strip-types src/cli.ts --config ./mi-config.json ~/Downloads
```

## Evidencia

- **50/50 tests en verde** (`node --test`, 3 suites: classify / config / mover) y **typecheck limpio** (`tsc --noEmit`).
- **Capturas reales del CLI** en `docs/evidence/`: help, versión, dry-run, ejecución real, idempotencia, colisiones, configuración por capas, archivos ocultos y manejo de errores.
- **5 axiomas** verificados por tests (colisiones, idempotencia, dry-run con árbol de archivos idéntico, EXDEV con copia parcial limpia, omit/`Others`).

## Links

[GitHub — JulioN02/file-organizer](https://github.com/JulioN02/file-organizer) · [Dashboard interactivo (GitHub Pages)](https://julion02.github.io/file-organizer/dashboard/) · [Guía de usuario](user-guide.md) · Obsidian: `Temporada 1/Proyectos rápidos/01 File Organizer.md` y `01 File Organizer — Ficha Técnica.md`