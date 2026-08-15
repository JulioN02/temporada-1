# JDEV — Kit de utilidades CLI para desarrollo

**Un solo binario, 10 utilidades de trabajo diario, dos formas de uso (terminal directa y TUI interactivo) y mensajes en español o inglés.**

JDEV es un kit de herramientas de desarrollo en línea de comandos: generar UUIDs, validar JSON, codificar base64, convertir timestamps, calcular hashes, hashear contraseñas con bcrypt, decodificar JWTs, procesar CSV y probar APIs — todo bajo un solo binario, con filosofía Unix (programas pequeños que hacen una cosa bien y se encadenan: `jdev csv tojson | jq`).

## Por qué CLI

| Forma | Ventaja | Costo |
| --- | --- | --- |
| GUI | Amigable | No automatizable, no componible |
| Librería | Reutilizable en código | El usuario final no la usa |
| **CLI** | **Automatizable** (scripts/CI), **componible** (pipes), universal | Exige respetar el contrato de texto |

Las utilidades de `jdev` las usa un humano **y** un script → el CLI es la única forma que sirve para ambos.

## Utilidades

| Módulo | Utilidad |
| --- | --- |
| `uuid` | UUID v4 / v7 (RFC 4122 y RFC 9562) |
| `json` | Formatea, minifica y valida JSON |
| `base64` | Codifica y decodifica base64 (estándar y URL-safe) |
| `timestamp` | Convierte entre epoch (Unix) e ISO 8601 |
| `hash` | SHA-256 / SHA-512 en streaming, memoria fija |
| `password` | Genera, hashea y verifica contraseñas (bcrypt) |
| `jwt` | Decodifica tokens JWT (solo lectura, seguro por diseño) |
| `csv` | Parser estricto RFC 4180 en streaming |
| `http` | Mini-curl con secrets enmascarados |
| `tui` | Menú interactivo que envuelve todo lo anterior |

## Diseño de ingeniería

- **Contrato de errores para scripts:** exit codes `0` (éxito), `1` (error de uso), `2` (error de ejecución), cada uno con un code estable (`INVALID_JSON`, `TIMEOUT`, `TLS`, …) que un script puede distinguir sin parsear texto.
- **Determinismo y pipes:** datos al stdout, errores al stderr; sin color en pipes por defecto; EPIPE silencioso (`jdev uuid | head -1` no rompe el pipeline); streaming con memoria acotada en hash y CSV.
- **Seguridad por diseño:** bcrypt con guard de 72 bytes (medido en bytes UTF-8), generación aleatoria siempre con `randomBytes` (nunca `Math.random`), JWT sin tocar la firma, cabeceras HTTP sensibles siempre enmascaradas, `--insecure` scoped a una sola request.
- **Arquitectura en capas:** `core/` (lógica pura), `cli/` (commander), `tui/` (inquirer), `i18n/` (es/en, español canónico) y `utils/` (io y output).
- **i18n:** mensajes en español o inglés, auto-detecta el locale del sistema o se fuerza con `JDEV_LANG` / `--lang`.

## Stack

TypeScript (ESM) · Node.js >= 22.12 · commander v15 · @inquirer/prompts · bcryptjs · undici

## Ejemplos rápidos

```bash
jdev uuid --v7 --count 3          # 3 UUIDs v7 ordenados por tiempo
echo '{"a":1}' | jdev json format # formatea JSON desde un pipe
jdev password hash "misecreto"    # hashea con bcrypt
jdev csv info export.csv          # filas y columnas de un export
jdev http -H "Authorization: Bearer x" https://api.example.com  # secrets enmascarados
jdev tui                          # menú interactivo (español/inglés)
```

## Linked

[GitHub](https://github.com/) · [npm](https://www.npmjs.com/)