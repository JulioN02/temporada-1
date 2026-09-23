# EXP-05 · Mini Storage Engine

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: ✅ Implementado · 🗄️ Archivado

## Qué construiste

Un mini motor de almacenamiento estilo SQLite: un almacén clave-valor síncrono
respaldado por un **write-ahead log (WAL)** de líneas JSON (NDJSON) de solo
append, con un **índice en memoria** (`Map`) y **recuperación por replay** al
abrir. Cero dependencias de runtime, solo `node:` builtins.

```
createStorage(path)  →  { get, set, delete, close }
```

- `set(key, value)` → agrega un registro SET al log, hace `fsync` y actualiza el índice
- `get(key)` → lee del índice en memoria (sin I/O); clave ausente → `undefined`
- `delete(key)` → agrega un registro DELETE + `fsync`; clave ausente → `false` sin escribir nada
- `close()` → `fsync` final + cierra el descriptor; un segundo `close()` lanza error

El log es un archivo de texto plano, inspeccionable con `cat`:

```
{"magic":"JSMKV1","version":1}
{"op":"SET","key":"a","value":"1","seq":1}
{"op":"SET","key":"b","value":"2","seq":2}
{"op":"DELETE","key":"a","seq":3}
```

## Cómo funciona

Cuatro módulos con una cadena de dependencias sin ciclos (`types → log → recovery → storage`):

- **`src/types.ts`** — el contrato del formato: códigos de operación (`SET`/`DELETE`),
  la cabecera mágica, la unión discriminada de registros y la interfaz pública.
- **`src/log.ts`** (puro, sin I/O) — el formato físico: serializa registros a líneas
  `\n`-terminadas y parsea un `Buffer` a registros + **offset de truncación**. El
  parseo es por bytes (división en `0x0A`), así que los offsets son offsets de
  byte nativos: nunca parten un carácter multibyte. Un header inválido o una
  corrupción en medio del archivo lanzan error; solo la última línea (cola rota)
  se trunca.
- **`src/recovery.ts`** (puro, sin I/O) — la reconstrucción lógica: replay de los
  registros en orden de archivo (`SET` upsert, `DELETE` remove, gana la última
  escritura) y restauración del contador de secuencia.
- **`src/storage.ts`** — la capa de I/O: un solo descriptor `openSync(path, 'a+')`,
  la validación + truncación + replay al abrir, y las operaciones `get/set/delete/close`
  como clausuras sobre `{fd, index, seq, closed}`.

Mecánica de una escritura (`set`): se construye el registro con la siguiente
secuencia monotónica, se escribe la línea al final del archivo (append puro,
los bytes anteriores nunca se tocan), se hace `fsync` **antes de retornar** y
recién entonces se actualiza el `Map` en memoria. La durabilidad es honesta:
una escritura está en disco cuando la llamada vuelve. Es lento a propósito —
esa es la lección del group-commit.

Mecánica de apertura (`createStorage`): abre-o-crea el archivo, lee el log
completo, valida el header, **trunca la cola rota si existe (antes de servir
cualquier lectura/escritura)**, hace replay y restaura `seq`. Un archivo vacío
es un almacén nuevo válido: la cabecera se escribe junto con el primer registro.

## Cómo ejecutar

```bash
npm install
npm test          # suite completa con node --test (49 tests, 8 archivos)
npm run typecheck # tsc --noEmit (TS strict, sin any)
```

Ejemplo rápido:

```ts
import { createStorage } from './src/storage.ts';

const store = createStorage('/tmp/mi-almacen.log');

store.set('user:1', 'Ana');
store.set('user:2', 'Luis');
console.log(store.get('user:1')); // 'Ana'

store.delete('user:1');
console.log(store.get('user:1')); // undefined

store.close();
// Al reabrir, el estado se reconstruye desde el log:
const otraVez = createStorage('/tmp/mi-almacen.log');
console.log(otraVez.get('user:2')); // 'Luis'
otraVez.close();
```

## Qué entendiste

Cómo funciona realmente el almacenamiento de una base de datos, con la
implementación en la mano:

- **El WAL hace rápidas las escrituras**: append secuencial al final del archivo;
  nunca se reescriben bytes anteriores. El costo es que el archivo crece sin límite
  — por eso existe la compactación (diferida aquí).
- **El índice en memoria hace rápidas las lecturas**: el `Map` evita escanear el
  log en cada `get`. La memoria es la caché; el log es la verdad durable.
- **El recovery es un replay**: el estado no se guarda, se *reconstruye* desde el
  log en orden. Por eso el orden de los registros y la secuencia importan.
- **Solo la cola puede estar rota**: en un archivo append-only, un crash a mitad
  de escritura deja una última línea incompleta — se trunca al último límite
  válido. Una corrupción en medio del archivo es otra cosa: hay que lanzar error,
  nunca truncar en silencio.
- **`fsync` es la frontera de durabilidad**: sin `fsync`, la escritura puede estar
  solo en la caché del sistema operativo. Con `fsync` por escritura, la durabilidad
  es real pero el costo es alto — la lección del group-commit.

## Por qué

Alineado con la identidad **Systems-oriented**: el storage es la base de todo
producto. Entender por dentro cómo se escriben, recuperan y duplican los datos
explica el comportamiento de cualquier base de datos que uses — y qué significa
realmente "persistente".

## Relación con otros experimentos

- **PostgreSQL mapping**: el log NDJSON es un WAL en miniatura; el `Map` en
  memoria es una caché de páginas; la compactación diferida es el checkpoint; la
  truncación de la cola rota es el crash recovery; la cabecera `JSMKV1` es el
  versionado de formato.
- EXP-03 Mini Message Queue: ambas requieren persistencia y recovery — esta es la
  base de almacenamiento que aquella podría usar.
- CAPSTONE: puede servir como persistencia del insignia (un solo proceso, API síncrona).
- Conecta con Temporada 8 (Systems Engineering).