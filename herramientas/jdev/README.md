# JDEV

Kit de herramientas de desarrollo en línea de comandos (CLI). **10 utilidades de trabajo diario bajo un solo binario**, con dos formas de uso (terminal directa y menú interactivo TUI) y con interfaz de mensajes en **español o inglés**.

```bash
# Lo que puedes hacer con jdev
jdev uuid --v7 --count 3        # 3 UUIDs v7 ordenados por tiempo
echo '{"a":1}' | jdev json format  # formatea JSON desde un pipe
jdev password hash "misecreto"  # hashea con bcrypt
jdev tui                        # menú interactivo en pantalla completa
```

## Instalación

JDEV se descarga e instala de dos maneras: desde el registro oficial de npm o clonando el repositorio de GitHub. En ambos casos no necesita configuración: funciona apenas se instala.

### Desde npm (recomendado)

```bash
npm install -g jdev
```

Esto instala el binario global `jdev` y queda listo para usar.

### Desde GitHub (código fuente)

```bash
git clone https://github.com/JulioN02/JDEV-TOOL.git
cd JDEV-TOOL
npm install
```

Para ejecutarlo desde el código fuente:

```bash
# opción A: construir el binario
npm run build
npm link

# opción B: ejecutar directo desde TypeScript (requiere node >= 22.12)
node src/index.ts --version
```

### Verificación

```bash
jdev --version   # 0.13.0
jdev --help      # lista los 10 subcomandos
```

Requisito: **Node.js >= 22.12.0**.

## Utilidades

| Módulo | Utilidad |
| --- | --- |
| `uuid` | Genera identificadores únicos (UUID v4 / v7) |
| `json` | Formatea, minifica y valida JSON |
| `base64` | Codifica y decodifica base64 (estándar y URL-safe) |
| `timestamp` | Convierte entre epoch (Unix) e ISO 8601 |
| `hash` | Calcula hashes SHA-256 / SHA-512 (streaming) |
| `password` | Hashea, verifica y genera contraseñas (bcrypt) |
| `jwt` | Decodifica tokens JWT (solo lectura) |
| `csv` | Inspecciona, normaliza y convierte CSV (RFC 4180) |
| `http` | Hace peticiones HTTP tipo mini-curl con secrets enmascarados |
| `tui` | Menú interactivo que envuelve todo lo anterior |

## ¿Por qué un CLI (y no GUI o librería)?

Un CLI es un programa que se opera escribiendo texto en una terminal. Su esencia es un contrato de texto:

```bash
programa [comandos] [flags] [argumentos]
```

| Forma | Ventaja | Costo |
| --- | --- | --- |
| GUI | Amigable | No automatizable, no componible |
| Librería | Reutilizable en código | El usuario final no la usa |
| **CLI** | **Automatizable** (scripts/CI), **componible** (pipes), universal | Exige respetar el contrato de texto |

Las utilidades de `jdev` las usa un humano **y** un script → el CLI es la única forma que sirve para ambos. Filosofía Unix: programas pequeños que hacen una cosa bien y se encadenan (`jdev csv | jdev json`).

## Campos de uso

**Desarrollo diario:** Generar IDs, validar/configurar JSON, inspeccionar JWT, probar APIs, hashear/verificar contraseñas, limpiar CSV y timestamps.

**Automatización y scripting:** Pipelines de datos (`csv tojson | jq`), checks de CI (usa los exit codes), verificación de integridad en releases (`hash`), generación de seeds (`uuid`/`password`), transformación de exports.

**Seguridad práctica:** Contraseñas con **bcrypt** correcto desde el día 1, tokens leídos sin exponer la firma, requests HTTP con secrets enmascarados.

## Terminal directa vs TUI

JDEV se usa de dos maneras distintas.

### Uso por terminal (CLI plano)

Se escribe el comando completo con sus opciones y se obtiene un resultado:

```bash
$ jdev uuid --v7 --count 3
$ echo '{"a":1}' | jdev json format
$ jdev password hash "misecreto"
```

- Orientado a **datos**: la salida es pura (uuids, JSON, hashes…) y se puede **pipear** (encadenar con `|`, redirigir a archivos, alimentar scripts).
- Es la vía **para scripting y automatización**: su salida es estable y sus códigos de salida (`0`, `1`, `2`) permiten que un script sepa si algo falló.
- Cada subcomando tiene su propio `--help`.

### Uso interactivo (TUI)

`jdev tui` abre un **menú en pantalla completa** (requiere una terminal interactiva):

```bash
$ jdev tui
```

- Navegás con flechas / `j` / `k`, Enter para seleccionar.
- 12 opciones: los 9 módulos, **Modo libre** (escribís un comando `jdev` completo a mano), **Idioma (es/en)** y **Salir**.
- El TUI te guía: te pregunta los parámetros uno por uno (versión de UUID, cantidad, archivo, etc.) y muestra los resultados.
- Cambio de idioma **en caliente**: elegís "Idioma" y todo el menú se re-renderiza al instante.
- No apto para scripting: sin terminal interactiva (TTY) sale con error (`exit 1`); la vía para scripts es el CLI plano.

## Requisitos mínimos

| Requisito | Valor | Por qué |
| --- | --- | --- |
| Node.js | **>= 22.12.0** | las dependencias (commander v15) son ESM-only y la CLI usa APIs modernas |
| Terminal | cualquiera para CLI plano; **interactiva (TTY)** para `jdev tui` | el TUI dibuja menús y lee teclas |
| Sistema | Linux, macOS o Windows con Node | código multiplataforma |
| Configuración | ninguna | funciona sin archivos de config |
| Idiomas | español o inglés (auto-detecta el locale del sistema) | sin configuración inicial |

Variables de entorno útiles:

- `JDEV_LANG=es` o `JDEV_LANG=en` — fuerza el idioma (por debajo del flag `--lang`, por encima del locale).
- `NO_COLOR=1` — desactiva colores (estándar de la comunidad).
- `FORCE_COLOR=1` — fuerza colores incluso en pipes.

---

# Referencia de módulos

## jdev uuid — Genera UUIDs (RFC 4122)

Genera UUIDs (Universally Unique IDentifier): identificadores de 128 bits (16 bytes) con formato estándar `8-4-4-4-12`.

Soporta dos versiones según estándares públicos:

- **V4 (RFC 4122) Aleatorio:** 122 bits generados criptográficamente. La chance de colisión es despreciable (se pueden generar miles de millones sin miedo).
- **V7 (RFC 9562) Ordenado por tiempo:** los primeros bits guardan una marca de tiempo; los UUIDs recién generados se ordenan cronológicamente (perfecto para índices de bases de datos).

#### Usos

- Claves primarias (evita exponer IDs secuenciales)
- Nombres de archivos temporales
- IDs de trazas/eventos
- Entidades en APIs

**Capacidades:** generar en cualquier cantidad, ya sea V4 o V7, con salida limpia de una por línea.

**Limitaciones:** no valida ni repara UUIDs ajenos; no hay modo lectura de un UUID existente.

### Comandos

| Comando | Función |
| --- | --- |
| `jdev uuid` | genera 1 UUID v4 (por defecto) |
| `jdev uuid --v4 [--count N]` | genera N UUIDs v4 |
| `jdev uuid --v7 [--count N]` | genera N UUIDs v7 (ordenados por tiempo) |

#### Ejemplos

```bash
$ jdev uuid --v7 --count 2
01a007c2-6f3d-775c-bd69-5cac5af37e0c
01a007c2-6f42-727e-9533-da0675232d88
```

Dos UUIDs v7 en una sola llamada, uno por línea. Los primeros 12 caracteres hex son la marca de tiempo (ms): como los v7 se generaron en el mismo instante, el prefijo es idéntico y crece entre llamadas — por eso son ordenables cronológicamente.

```bash
$ jdev uuid
33a94fcf-3127-4ddb-a4d6-0a6a3b8b0c5d
```

Sin argumentos devuelve un v4 (el valor es aleatorio y distinto en cada ejecución).

---

## jdev json — JSON profesional

Formatea, minifica y valida JSON desde un archivo, un pipe o (en el TUI) por prompts.

JSON es el formato de intercambio de datos estándar (objetos `{"clave": valor}`).

#### Usos

- Revisar respuestas de APIs
- Preparar datos para microservicios
- Validar configs (`.json`)
- Limpiar archivos exportados

**Capacidades:** posición exacta del error (línea y columna), entrada por archivo/stdin/flag, todos los errores y veredictos de parseo localizados (validate, format y minify por igual).

**Limitaciones:** no hace transformaciones; no puede renombrar claves ni filtrar.

Tres operaciones complementarias:

- `format`: vuelve legible un JSON comprimido (indenta 2 espacios)
- `minify`: lo compacta a una línea (menos bytes, ideal para APIs/logs)
- `validate`: chequea que sea JSON válido y devuelve un veredicto

### Comandos

| Comando | Función |
| --- | --- |
| `jdev json validate [archivo]` | ¿es JSON válido? → veredicto + código de salida |
| `jdev json format [archivo]` | JSON comprimido → JSON indentado 2 espacios |
| `jdev json minify [archivo]` | JSON indentado → JSON en una línea |

#### Ejemplos

```bash
$ echo '{"a":1,"b":[1,2]}' | jdev json format
{
  "a": 1,
  "b": [
    1,
    2
  ]
}
```

JSON comprimido por stdin → formateado con indentación de 2 espacios en stdout.

```bash
$ echo '{"a":' | jdev json validate
invalid JSON at line 2, column 1
$ echo $?
2
```

JSON roto → veredicto localizado con la posición exacta del error y exit code `2` (error de ejecución). Un JSON válido responde `valid JSON` con exit `0`.

---

## jdev base64 — Codificación Base64

Codifica o decodifica texto/binario a base64 (RFC 4648) en variante estándar o URL-safe.

Base64 representa bytes binarios con 64 caracteres seguros (`A–Z a–z 0–9 + /`) agrupados de a 3 bytes → 4 caracteres. Sirve para transportar datos binarios por canales que solo aceptan texto (JSON, URLs, emails).

La variante `--url` usa `-_` en vez de `+/` y omite el padding `=`. Es la que usan JWT y los query params.

#### Usos

- Codificar/decodificar datos en APIs
- Armar payloads para URLs
- Inspeccionar partes de tokens
- Incrustar imágenes pequeñas en texto

**Capacidades:** entrada por archivo o stdin, salida binaria exacta al decodificar.

**Limitaciones:** `jdev base64 decode f > imagen.png` — el segundo argumento es una ruta de archivo, no un texto inline. Para codificar un string hay que pipearlo: `echo -n "hola" | jdev base64 encode`. Decodificar entrada inválida es error.

### Comandos

| Comando | Función |
| --- | --- |
| `echo -n "texto" \| jdev base64 encode` | codifica texto (viene por stdin) |
| `jdev base64 encode archivo.txt` | codifica el contenido de un archivo |
| `echo -n "texto" \| jdev base64 encode --url` | variante URL-safe, sin `=` |
| `echo -n "base64..." \| jdev base64 encode --url -p` | igual pero forzando padding |
| `echo -n "aG9sYQ==" \| jdev base64 decode` | decodifica a texto/binario |

#### Ejemplos

```bash
$ echo -n "hola" | jdev base64 encode
aG9sYQ==
$ echo -n "aG9sYQ==" | jdev base64 decode
hola
```

El par encode/decode es simétrico. Sin `-n` en `echo` entra un `\n` extra y el base64 cambia — por eso los ejemplos usan `echo -n`.

```bash
$ echo -n "hola mundo?" | jdev base64 encode --url
aG9sYSBtdW5kbz8
```

La variante `--url` usa `-_` y omite el `=` final (válido en query params y JWT).

---

## jdev timestamp — Tiempo UNIX ↔ ISO 8601

Muestra el tiempo actual o convierte épocas (segundos o milisegundos desde `1970-01-01 UTC`) a fechas legibles y viceversa.

El **epoch Unix** es el número de segundos (o ms) desde `1970-01-01T00:00:00Z`. La forma en que las máquinas guardan el tiempo.

**ISO 8601** es el formato legible que usan las APIs: `2013-12-02T04:30:00.000Z`.

#### Usos

- Traducir `exp` de un JWT (son segundos)
- Fechas en logs
- Configuraciones de expiración
- Debugging de timestamps en bases de datos

**Capacidades:** `--iso` (formato legible), `--local` (offset numérico de tu zona), `--ms` (milisegundos).

**Limitaciones:** el epoch de entrada se interpreta en **segundos** salvo que pases `--ms` — pasar un valor de ms sin `--ms` produce una fecha absurda (año 57 000).

### Comandos

| Comando | Función |
| --- | --- |
| `jdev timestamp` | segundos Unix actuales |
| `jdev timestamp --ms` | milisegundos Unix actuales |
| `jdev timestamp --iso` | hora actual en ISO 8601 UTC |
| `jdev timestamp --iso --local` | hora actual ISO con offset local |
| `jdev timestamp <epoch> [--ms] [--iso] [--local]` | convierte un epoch dado |

#### Ejemplos

```bash
$ jdev timestamp
1786836527
```

Segundos Unix actuales — el formato en el que las máquinas guardan el tiempo.

```bash
$ jdev timestamp 1710000000 --iso
2024-03-09T16:00:00.000Z
```

Epoch en segundos → ISO 8601 legible (`Z` = UTC). Ideal para traducir el `exp` de un JWT.

---

## jdev hash — Huella digital de datos (SHA)

Calcula el hash **SHA-256** (o **SHA-512**) de un archivo o de lo que llegue por stdin, en streaming.

Un hash criptográfico es una "huella digital" de longitud fija: el mismo contenido produce siempre el mismo hash; cambiar un solo byte produce un hash totalmente distinto.

- SHA-256 da 64 hex (32 bytes)
- SHA-512 da 128 hex (64 bytes)

Se usan para verificar integridad de descargas, deduplicar contenido y firmas. No se puede revertir (no es cifrado, es resumen).

#### Usos

- Verificar que un archivo descargado no se corrompió (`sha256sum` portátil)
- Comparar dos archivos sin copiarlos
- Checksums en CI
- Identificar duplicados

**Capacidades:** streaming — procesa archivos enormes con memoria fija (no carga todo en RAM); stdin, archivo o `-`; `-a sha256|sha512`.

**Limitaciones:** solo SHA-256/512 (deliberado).

### Comandos

| Comando | Función |
| --- | --- |
| `echo -n "texto" \| jdev hash` | SHA-256 de un texto |
| `jdev hash archivo.iso` | SHA-256 de un archivo |
| `jdev hash --algorithm sha512 archivo.iso` | SHA-512 (o `-a sha512`; `--algo sha512` también vale) |
| `jdev hash -i archivo` / `--file archivo` | alias de entrada |

#### Ejemplos

```bash
$ echo -n "texto" | jdev hash
f46e3b17a6b639e5efddc3d1498ad73491599c22220f7ef6e14772f4ee25b913
```

64 caracteres hex (32 bytes) = SHA-256. El mismo contenido produce siempre el mismo hash; un byte distinto cambia todo el resultado.

```bash
$ jdev hash -a sha512 archivo.iso
```

Procesa el archivo en streaming: memoria fija aunque el archivo pese gigas. Ideal para verificar descargas (`jdev hash archivo.iso` == checksum oficial).

---

## jdev password — Contraseñas con bcrypt

Genera contraseñas aleatorias fuertes, las hashea con **bcrypt** y verifica una contraseña contra un hash sin revelar nada.

El fundamento de este módulo es que guardar contraseñas en texto plano está prohibido en producción. Bcrypt aplica un work factor que hace el hash deliberadamente lento y agrega una sal aleatoria (dos hashes de la misma contraseña son distintos). La verificación es timing-safe (no filtra información por velocidad de respuesta).

#### Usos

- Registrar usuarios
- Verificar logins
- Generar contraseñas temporales para equipos, demos y seeds

**Capacidades:**

- Hash con costo configurable `--cost 4..31`
- Generar con longitud `--length 1..1024` (charset `A-Za-z0-9_-`, usando `randomBytes` criptográfico — nunca `Math.random`)
- Veredictos localizados
- Prefijo del hash: `$2b$`

**Limitaciones:** bcrypt usa máximo 72 bytes — jdev rechaza contraseñas que excedan ese límite (por bytes UTF-8, no por caracteres) ANTES de que bcrypt pudiera truncarlas silenciosamente.

### Comandos

| Comando | Función |
| --- | --- |
| `jdev password generate [--length N]` | genera una contraseña aleatoria (default 16) |
| `jdev password hash "<clave>" [--cost N]` | hashea con bcrypt (default cost 10) |
| `jdev password verify "<clave>" "<hash>"` | ¿coincide? → veredicto (y exit code) |

#### Ejemplos

```bash
$ jdev password hash "misecreto"
$2b$10$aQN.lCty6E6dWRnnH10azOLNI8TQxtDgmpbK8azuaSP7y.V71g3Ci
```

Hash bcrypt con prefijo `$2b$` (cost 10 por defecto). Cada ejecución produce un hash **distinto** (sal aleatoria) aunque la clave sea la misma — la verificación funciona igual.

```bash
$ jdev password verify "misecreto" '$2b$10$aQN.lCty6E6dWRnnH10azOLNI8TQxtDgmpbK8azuaSP7y.V71g3Ci'
Contraseña correcta
```

Timing-safe: `Contraseña correcta` (exit `0`) / `Contraseña incorrecta` (exit `2`) — nunca revela más que eso.

---

## jdev jwt — Decodificar tokens JWT (solo lectura)

Decodifica el **HEADER** y el **PAYLOAD** de un token JWT y los muestra como JSON legible. Nunca toca la firma.

Un JWT tiene 3 partes separadas por puntos (`header.payload.signature`), cada una en base64url. Se usa para sesiones/autenticación de APIs.

jdev es solo lectura por diseño: decodifica las dos primeras partes y omite la firma por completo. No tiene ni `--verify` ni `--secret`. Ver contenido no verifica autenticidad: eso es trabajo de la app que lo emite.

#### Usos

- Inspeccionar qué contiene un token (roles, `exp`, `sub`)
- Debugging de sesiones
- Lectura de claims en desarrollo

**Capacidades:** decodifica header + payload en JSON formateado (2 espacios); seguro por diseño (nunca imprime ni filtra el contenido de la firma; los errores no repiten el token).

**Limitaciones:** no verifica; el token va como argumento posicional (no acepta stdin — `cat token | jdev jwt` falla).

### Comando

| Comando | Función |
| --- | --- |
| `jdev jwt "<token>"` | decodifica header y payload |

#### Ejemplos

```bash
$ jdev jwt "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ikp1YW4iLCJhZG1pbiI6dHJ1ZSwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "1234567890",
    "name": "Juan",
    "admin": true,
    "iat": 1516239022
  }
}
```

Header y payload como JSON legible (2 espacios). La firma (tercera parte) **nunca** se decodifica ni se imprime.

---

## jdev csv — CSV a fondo (RFC 4180)

Inspecciona, normaliza y convierte CSV con un parser estricto RFC 4180 y streaming.

CSV es el formato tabular universal (export/import de Excel, bases de datos, datos abiertos).

RFC 4180 define las reglas: comillas dobles para campos con comas, `""` para una comilla literal, CRLF como fin de línea.

jdev lo procesa en streaming, fila por fila con memoria acotada. Puede digerir archivos de 18 MB sin problema. Es estricto: texto suelto después de una comilla de cierre es error (no lo arregla silenciosamente).

#### Usos

- Resuelve la pregunta: ¿cuántas filas tiene este export?
- Normalizar CSV rotos (BOM, CRLF)
- Convertir a JSON para APIs
- Pipelines de datos

**Capacidades:** `info` (filas/columnas), `format` (normaliza: BOM fuera, CRLF→LF, comillas correctas), `tojson` (a JSON en streaming).

**Limitaciones:** no transforma ni filtra columnas; todos los valores en `tojson` quedan como **strings** (`"1"` no `1`); `tojson` sin salto de línea final al pipear (byte-puro).

### Comandos

| Comando | Función |
| --- | --- |
| `jdev csv info archivo.csv` | filas (sin header) y columnas |
| `jdev csv format archivo.csv` | normaliza a RFC 4180 limpio |
| `jdev csv tojson archivo.csv` | convierte a array de objetos JSON |

#### Ejemplos

```bash
$ printf 'id,nombre\r\n1,Ana\r\n2,"Beto, el grande"\r\n' | jdev csv format
id,nombre
1,Ana
2,"Beto, el grande"
```

Input sucio (BOM + CRLF) → RFC 4180 limpio: `\r\n` → `\n`, BOM fuera, comillas donde corresponden.

```bash
$ printf 'id,nombre\n1,Ana\n2,Beto\n' | jdev csv tojson
[{"id":"1","nombre":"Ana"},{"id":"2","nombre":"Beto"}]
```

Array de objetos JSON en streaming: todos los valores quedan como strings (`"1"`, no `1`) — fiel al CSV original.

---

## jdev http — Mini curl con secreto protegido

Hace peticiones HTTP desde la terminal mostrando la respuesta como texto plano, con los secretos siempre enmascarados (`***`).

HTTP es el protocolo de la web y `curl` es su herramienta clásica. jdev imprime el **código de estado + cabeceras + cuerpo** y, por diseño, enmascara las cabeceras sensibles (`authorization`, `cookie`, `set-cookie`) porque copiar/pegar tokens es la forma más común de filtraciones.

El status HTTP es dato, no error: un 404 sale con exit `0` (el error real es no-poder-conectar: timeout, DNS, TLS).

#### Usos

- Probar APIs REST durante desarrollo
- Ver cabeceras reales (incluida `set-cookie`)
- Debugging local y demos

**Capacidades:** método (`-X`), cabeceras repetibles (`-H "Name: value"`), body (`-d`), timeout (`--timeout` segundos), `--insecure` (saltea verificación TLS **solo para esa request**, nunca global).

**Limitaciones:** no descarga archivos gigantes ni hace streaming de respuestas; errores de red → stdout vacío y exit 2.

### Comandos

| Comando | Función |
| --- | --- |
| `jdev http URL` | GET (por defecto) |
| `jdev http -X POST URL` | método explícito |
| `jdev http -d '{"a":1}' URL` | body → implica POST |
| `jdev http -H "Authorization: Bearer x" URL` | cabecera (repetible) |
| `jdev http --timeout 5 URL` | aborta a los 5 s |
| `jdev http --insecure https://…` | saltea TLS solo en esta llamada |

#### Ejemplos

```bash
$ jdev http https://api.example.com/set-cookie
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
set-cookie: ***
...
{"ok":true}
```

Respuesta como texto plano: código de estado + cabeceras + cuerpo. Las cabeceras sensibles de la **respuesta** (`authorization`, `cookie`, `set-cookie`) se imprimen como `***` — copiar/pegar tokens es la forma más común de filtrarlos. Un 404 también sale con exit `0` (el status es dato, no error).

```bash
$ jdev http -X POST -d '{"a":1}' https://api.example.com/echo
```

`-d` manda el body e implica POST; `-H "Authorization: Bearer x"` añade cabeceras (repetible). El secret se **transmite** al destino (como curl) pero nunca se imprime en pantalla.

---

# Ingeniería del sistema

## Contrato de errores

Los códigos de salida son la parte más importante para scripts:

| **CÓDIGO** | SIGNIFICADO | EJEMPLO |
| --- | --- | --- |
| **0** | Éxito (dato o veredicto en stdout) | UUID, HASHES, JSON válido, HTTP aunque sea 404 |
| **1** | Error de **uso** (el comando está mal escrito/no se puede ejecutar así) | Flag inválido, acción desconocida, TUI sin TTY |
| **2** | Error de **ejecución** (la operación falló en tiempo de carrera) | Archivo no existe, JSON inválido, bcrypt malformado, timeout de red, verify mismatch |

Cada error tiene un **code** estable (`IO_READ`, `INVALID_JSON`, `INVALID_BCRYPT_HASH`, `TIMEOUT`, `TLS`, …) para que un script distinga tipos sin parsear texto.

## Pipes y determinismo

- **Datos al stdout, errores al stderr:** así `jdev uuid > archivo` jamás contamina el archivo con mensajes.
- **Sin color en pipes por defecto:** (`NO_COLOR / FORCE_COLOR` override estándar) la salida es byte exacta y estable.
- **Newline inteligente:** los comandos de datos terminan con `\n`; los binarios seguros (`base64 decode`, `csv tojson`, cuerpo de `http`) escriben verbatim cuando están pipeados para que quede byte puro y agregan `\n` solo visual en TTY.
- **EPIPE silencioso:** `jdev uuid | head -1` no rompe el pipeline.
- **Streaming en HASH y CSV:** memoria acotada aunque el archivo pese gigas (se procesa por chunks/filas).

## Seguridad por diseño

- **Contraseñas:** bcrypt con sal, costo configurable, verificación timing-safe, guard de 72 bytes medido en bytes UTF-8 (no caracteres) — aplicado antes de bcrypt para que nunca trunque en silencio.
- **Generación aleatoria:** siempre `randomBytes` criptográfico, nunca `Math.random`.
- **JWT:** la firma jamás se decodifica ni se imprime; los errores no repiten el token.
- **HTTP:** cabeceras `authorization / cookie / set-cookie` siempre mostradas como `***`; `--insecure` es scoped a la request (un **Agent** de undici por llamada, nunca un dispatcher global).
- **UUID v4:** aleatoriedad criptográfica.

### Notas de seguridad para uso en producción

- El enmascarado de `jdev http` es de **pantalla**: si pasás `-H "Authorization: Bearer x"`, el header **se transmite** al destino (igual que `curl`) — solo no se imprime en tu terminal.
- `jdev http` es un mini-curl: acepta URLs arbitrarias por diseño. En contextos automatizados o con privilegios, **no alimentes URLs o headers controlados por terceros** (riesgo de SSRF).
- `--insecure` saltea la verificación TLS **solo para esa request** — nunca para la sesión global. Úsalo solo contra servidores de desarrollo que conocés.

## Arquitectura: organización en capas

```
src/
├── core/    lógica pura (sin tocar terminal): json, uuid, csv, errores…
├── cli/     capa de comandos: commander registra cada subcomando
├── tui/     capa interactiva: menú + prompts + batalla por módulo
├── i18n.ts  diccionarios es/en (es = canónico; en tipado contra las mismas claves)
└── utils/   io (lectura archivo/stdin, streaming) y output (color, newlines)
```

## Dependencias del programa (runtime)

| Dependencia | Versión | Para qué se usa |
| --- | --- | --- |
| `commander` | ^15 | Parseo de argumentos, ayuda automática, códigos de salida estandarizados (el "motor" del CLI) |
| `@inquirer/prompts` | ^8.5 | Las preguntas interactivas del TUI (menús, confirmaciones, entradas) |
| `bcryptjs` | ^3.0 | Hashing de contraseñas bcrypt (verificación timing-safe) |
| `undici` | ^8.10 | El cliente HTTP (fetch moderno de Node, con soporte de sockets y TLS controlado) |

## Limitaciones

- No es un servidor ni un framework (no corre aplicaciones).
- No verifica firmas JWT; no cifra/descifra (solo hashea contraseñas).
- No reemplaza a una GUI: es CLI-first con un TUI de menú.
- Algunos mensajes internos quedan en inglés (errores de uso, help de commander).

## Contribuciones y contacto

- **Bugs, sugerencias y aportes:** abrí un issue o un PR en el [repositorio de GitHub](https://github.com/JulioN02/JDEV-TOOL). Para reportar un problema, incluí la salida de `jdev --version` y el comando exacto que falló.
- **Seguridad:** si encontrás una vulnerabilidad, reportala con detalle. Esta herramienta es de lectura/verificación por diseño, pero reportar con tiempo siempre ayuda.
- **Autor y contacto:** Julio Nieto (`@JulioN02`). Los commits llevan autoría del proyecto; para preguntas directas, preferí los issues para que la respuesta quede pública y útil para todos.

## Licencia

MIT