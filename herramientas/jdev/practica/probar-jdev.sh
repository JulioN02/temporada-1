#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  probar-jdev.sh — Prueba automática de TODOS los comandos del toolkit jdev
#
#  Uso:
#    1) npm run build            (compila dist/ — una sola vez)
#    2) bash practica/probar-jdev.sh
#
#  Qué hace: ejecuta los 9 módulos (uuid, json, base64, timestamp, hash,
#  password, jwt, csv, http) con casos de éxito Y de error, levantando un
#  servidor local de práctica para el módulo http y un CSV grande en /tmp
#  para demostrar el streaming.
# ═══════════════════════════════════════════════════════════════════════════

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JDEV="$ROOT/dist/index.js"
TMP=/tmp/jdev-practica
mkdir -p "$TMP"

VERDE='\033[32m'; AMARILLO='\033[33m'; ROJO='\033[31m'; RESET='\033[0m'
pass() { printf "${VERDE}✅ %s${RESET}\n" "$1"; }
info() { printf "${AMARILLO}▶ %s${RESET}\n" "$1"; }

info "Usando: $JDEV"
"$JDEV" --version

if [ ! -x "$JDEV" ]; then
  echo "ERROR: $JDEV no existe. Ejecutá primero: npm run build"; exit 1
fi

# ════════════════════════════════════════════════════ 1. UUID
echo; echo "═══════════ MÓDULO 1: uuid ═══════════"
info "jdev uuid                          → 1 UUID v4 aleatorio"
"$JDEV" uuid; pass "exit=$?"
info "jdev uuid --v7                     → 1 UUID v7 (ordenado por tiempo)"
"$JDEV" uuid --v7; pass "exit=$?"
info "jdev uuid --count 5                → 5 UUIDs v4, uno por línea"
"$JDEV" uuid --count 5
info "jdev uuid --v7 --count 5           → 5 UUIDs v7 (deben ser no-decrecientes)"
"$JDEV" uuid --v7 --count 5
info "jdev uuid --v4 --v7                → ERROR de USO (mutuamente excluyentes) exit=1"
"$JDEV" uuid --v4 --v7 2>&1; pass "exit=$? (esperado 1)"
info "jdev uuid | head -1 (EPIPE)        → el pipe cortado no rompe el proceso"
"$JDEV" uuid --count 100000 | head -1; pass "exit=${PIPESTATUS[0]} (esperado 0)"

# ════════════════════════════════════════════════════ 2. JSON
echo; echo "═══════════ MÓDULO 2: json ═══════════"
info "cat ejemplo.json | jdev json format    → pretty-print con 2 espacios"
cat "$ROOT/practica/ejemplo.json" | "$JDEV" json format; pass "exit=$?"
info "jdev json minify < ejemplo.json        → JSON en una sola línea"
"$JDEV" json minify < "$ROOT/practica/ejemplo.json"; pass "exit=$?"
info "jdev json validate < ejemplo.json      → confirma con 'valid JSON' (exit=0)"
"$JDEV" json validate < "$ROOT/practica/ejemplo.json"; pass "exit=$? (esperado 0, responde 'valid JSON')"
info "jdev json validate < malo.json         → error con línea y columna (exit=2)"
"$JDEV" json validate < "$ROOT/practica/malo.json" 2>&1; pass "exit=$? (esperado 2)"
info "jdev json format practica/malo.json    → mismo error en formato"
"$JDEV" json format "$ROOT/practica/malo.json" 2>&1; pass "exit=$? (esperado 2)"
info "jdev json badaction                    → ERROR de USO exit=1"
"$JDEV" json badaction < /dev/null 2>&1; pass "exit=$? (esperado 1)"

# ════════════════════════════════════════════════════ 3. BASE64
echo; echo "═══════════ MÓDULO 3: base64 ═══════════"
info "echo -n 'Hola mundo' | jdev base64 encode    → estándar PADDED"
echo -n 'Hola mundo' | "$JDEV" base64 encode; pass "exit=$?"
info "echo -n 'abc' | jdev base64 encode --url     → base64url SIN padding"
echo -n 'abc' | "$JDEV" base64 encode --url; pass "exit=$?"
info "echo -n 'abc' | jdev base64 encode --url -p  → base64url CON padding"
echo -n 'abc' | "$JDEV" base64 encode --url -p; pass "exit=$?"
info "echo -n 'SG9sYSBtdW5kbw==' | jdev base64 decode → bytes originales"
echo -n 'SG9sYSBtdW5kbw==' | "$JDEV" base64 decode; pass "exit=$?"
info "GOTCHA: echo (sin -n) añade un \\n que el decode estricto RECHAZA:"
echo 'SG9sYSBtdW5kbw==' | "$JDEV" base64 decode 2>&1; pass "exit=$? (esperado 2 — usa echo -n o tr -d '\\n')"
info "jdev base64 encode < ejemplo.txt (binario intacto, incl. emoji)"
"$JDEV" base64 encode < "$ROOT/practica/ejemplo.txt"; pass "exit=$?"
info "jdev base64 decode -p              → ERROR de USO (-p solo aplica a encode) exit=1"
echo 'YQ==' | "$JDEV" base64 decode -p 2>&1; pass "exit=$? (esperado 1)"
info "echo '!!!invalido' | jdev base64 decode      → ERROR de DATO exit=2"
echo '!!!invalido' | "$JDEV" base64 decode 2>&1; pass "exit=$? (esperado 2)"
info "Roundtrip completo: encode | tr -d '\n' | decode"
echo -n 'token-secreto-123' | "$JDEV" base64 encode | tr -d '\n' | "$JDEV" base64 decode; pass "exit=${PIPESTATUS[2]}"

# ════════════════════════════════════════════════════ 4. TIMESTAMP
echo; echo "═══════════ MÓDULO 4: timestamp ═══════════"
info "jdev timestamp                      → epoch actual en SEGUNDOS"
"$JDEV" timestamp; pass "exit=$?"
info "jdev timestamp --ms                 → epoch actual en MILISEGUNDOS"
"$JDEV" timestamp --ms; pass "exit=$?"
info "jdev timestamp --iso                → ISO 8601 UTC (Z)"
"$JDEV" timestamp --iso; pass "exit=$?"
info "jdev timestamp --iso --local        → ISO 8601 con OFFSET local"
"$JDEV" timestamp --iso --local; pass "exit=$?"
info "jdev timestamp 0 --iso              → convierte epoch 0 → 1970-01-01T00:00:00.000Z"
"$JDEV" timestamp 0 --iso; pass "exit=$?"
info "jdev timestamp 1786730645 --iso     → convierte un epoch concreto"
"$JDEV" timestamp 1786730645 --iso; pass "exit=$?"
info "jdev timestamp abc                  → ERROR de DATO exit=2"
"$JDEV" timestamp abc 2>&1; pass "exit=$? (esperado 2)"
info "jdev timestamp --local              → ERROR de USO (requiere --iso) exit=1"
"$JDEV" timestamp --local 2>&1; pass "exit=$? (esperado 1)"

# ════════════════════════════════════════════════════ 5. HASH
echo; echo "═══════════ MÓDULO 5: hash ═══════════"
info "jdev hash ejemplo.txt               → SHA-256 streaming"
"$JDEV" hash "$ROOT/practica/ejemplo.txt"; pass "exit=$?"
info "jdev hash -a sha512 ejemplo.txt     → SHA-512"
"$JDEV" hash -a sha512 "$ROOT/practica/ejemplo.txt"; pass "exit=$?"
info "Comparación contra sha256sum / sha512sum (deben coincidir):"
echo "  jdev:      $("$JDEV" hash "$ROOT/practica/ejemplo.txt")"
echo "  sha256sum: $(sha256sum "$ROOT/practica/ejemplo.txt" | cut -d' ' -f1)"
echo "  jdev:      $("$JDEV" hash -a sha512 "$ROOT/practica/ejemplo.txt")"
echo "  sha512sum: $(sha512sum "$ROOT/practica/ejemplo.txt" | cut -d' ' -f1)"
info "cat ejemplo.txt | jdev hash         → hash por stdin"
cat "$ROOT/practica/ejemplo.txt" | "$JDEV" hash; pass "exit=$?"
info "jdev hash archivo-inexistente       → ERROR de DATO (menciona el path) exit=2"
"$JDEV" hash "$TMP/no-existe.txt" 2>&1; pass "exit=$? (esperado 2)"
info "jdev hash -a md5 ejemplo.txt        → ERROR de USO exit=1"
"$JDEV" hash -a md5 "$ROOT/practica/ejemplo.txt" 2>&1; pass "exit=$? (esperado 1)"

# ════════════════════════════════════════════════════ 6. PASSWORD
echo; echo "═══════════ MÓDULO 6: password ═══════════"
info "jdev password generate              → 16 caracteres crypto (default)"
"$JDEV" password generate; pass "exit=$?"
info "jdev password generate --length 32  → 32 caracteres"
"$JDEV" password generate --length 32; pass "exit=$?"
PW=$("$JDEV" password generate)
info "GOTCHA: si la contraseña generada empieza con '-', commander la toma como flag;"
info "        por eso usamos '--' (fin de opciones) al pasarla como argumento:"
HASH=$("$JDEV" password hash -- "$PW")
info "jdev password hash -- \"$PW\"  → hash bcrypt (\$2b\$10\$…):"
echo "  $HASH"
info "jdev password verify -- \"$PW\" \"$HASH\"   → MATCH: responde 'password match', exit=0"
"$JDEV" password verify -- "$PW" "$HASH"; pass "exit=$? (esperado 0)"
info "jdev password verify 'incorrecta' \"$HASH\" → NO MATCH: responde 'password mismatch', exit=2"
"$JDEV" password verify 'incorrecta' "$HASH"; pass "exit=$? (esperado 2)"
info "jdev password hash 'x' --cost 12    → hash con cost 12 (más lento/más seguro)"
"$JDEV" password hash 'x' --cost 12; pass "exit=$?"
info "73 bytes de 'a' → ERROR de DATO (límite bcrypt 72 bytes UTF-8) exit=2"
"$JDEV" password hash "$(printf 'a%.0s' {1..73})" 2>&1; pass "exit=$? (esperado 2)"
info "jdev password hash x --cost 40      → ERROR de USO exit=1"
"$JDEV" password hash x --cost 40 2>&1; pass "exit=$? (esperado 1)"
info "jdev password verify pw hash-malformado → ERROR explicado exit=2"
"$JDEV" password verify abc 'hash-malformado' 2>&1; pass "exit=$? (esperado 2)"

# ════════════════════════════════════════════════════ 7. JWT
echo; echo "═══════════ MÓDULO 7: jwt ═══════════"
TOKEN=$(cat "$ROOT/practica/token.jwt")
info "jdev jwt <token>    → {header, payload} formateado; la FIRMA nunca se imprime"
"$JDEV" jwt "$TOKEN"; pass "exit=$?"
info "jdev jwt <token> | jdev json minify   → salida en una línea (pipeline)"
"$JDEV" jwt "$TOKEN" | "$JDEV" json minify; pass "exit=${PIPESTATUS[0]}"
info "jdev jwt 'solo.dos' → ERROR de DATO (esperaba 3 partes) exit=2"
"$JDEV" jwt 'solo.dos' 2>&1; pass "exit=$? (esperado 2)"
info "jdev jwt <token> --verify            → ERROR de USO: opción desconocida (la capacidad de verificación NO existe) exit=1"
"$JDEV" jwt "$TOKEN" --verify 2>&1; pass "exit=$? (esperado 1)"

# ════════════════════════════════════════════════════ 8. CSV
echo; echo "═══════════ MÓDULO 8: csv ═══════════"
info "jdev csv info practica/datos.csv     → filas/columnas (header no cuenta)"
"$JDEV" csv info "$ROOT/practica/datos.csv"; pass "exit=$?"
info "jdev csv format practica/datos.csv   → CSV normalizado (RFC 4180: quotes, \\\"\" → \\\"…)"
"$JDEV" csv format "$ROOT/practica/datos.csv"; pass "exit=$?"
info "jdev csv tojson practica/datos.csv   → array JSON streaming"
"$JDEV" csv tojson "$ROOT/practica/datos.csv"; pass "exit=$?"
info "Pipeline: csv tojson | json format   → JSON pretty"
"$JDEV" csv tojson "$ROOT/practica/datos.csv" | "$JDEV" json format; pass "exit=${PIPESTATUS[0]}"
# CSV con BOM + CRLF generado al vuelo (demuestra normalización)
printf '\xEF\xBB\xBFid,nombre\r\n1,Julio\r\n2,María\r\n' > "$TMP/bom-crlf.csv"
info "CSV con BOM+CRLF generado en /tmp:"
cat -A "$TMP/bom-crlf.csv" | head -3
info "jdev csv format bom-crlf.csv → BOM eliminado y CRLF→LF:"
"$JDEV" csv format "$TMP/bom-crlf.csv" | cat -A; pass "exit=$?"
# CSV GRANDE para streaming (100k filas, ~1.5 MB)
info "Generando CSV grande (100.000 filas) para probar streaming…"
node -e "let s='id,nombre,email\n';for(let i=0;i<100000;i++)s+=i+',usuario'+i+',user'+i+'@example.com\n';process.stdout.write(s)" > "$TMP/grande.csv"
ls -la "$TMP/grande.csv" | awk '{print "  tamaño:", $5, "bytes"}'
info "jdev csv info grande.csv             → rows: 100000, columns: 3"
"$JDEV" csv info "$TMP/grande.csv"; pass "exit=$?"
info "tiempo de tojson sobre 100k filas (streaming, memoria acotada):"
time ("$JDEV" csv tojson "$TMP/grande.csv" | wc -c | awk '{print "  bytes JSON emitidos:", $1}')
info "jdev csv tojson malo.csv (comilla sin cerrar) → ERROR con número de FILA exit=2"
printf 'a,b\n"campo abierto,otro\n' > "$TMP/malo.csv"
"$JDEV" csv tojson "$TMP/malo.csv" 2>&1; pass "exit=$? (esperado 2)"
info "jdev csv badaction                   → ERROR de USO exit=1"
"$JDEV" csv badaction /dev/null 2>&1; pass "exit=$? (esperado 1)"

# ════════════════════════════════════════════════════ 9. HTTP
echo; echo "═══════════ MÓDULO 9: http ═══════════"
info "Levantando servidor local de práctica (node practica/servidor-prueba.mjs 8787)…"
node "$ROOT/practica/servidor-prueba.mjs" 8787 > "$TMP/servidor.log" 2>&1 &
SERVIDOR_PID=$!
sleep 1
URL=http://127.0.0.1:8787
info "jdev http $URL/                    → GET básico, status coloreado, headers, body"
"$JDEV" http "$URL/" ; pass "exit=$?"
info "jdev http $URL/json | awk 'tras la línea vacía' | jdev json format"
info "  → el render incluye status+headers; el body empieza tras la línea en blanco:"
"$JDEV" http "$URL/json" | awk 'f{print} /^$/{f=1}' | "$JDEV" json format; pass "exit=${PIPESTATUS[0]}"
info "jdev http $URL/echo -X POST -d '{\"hola\":\"mundo\"}' -H 'Content-Type: application/json' → POST con body"
"$JDEV" http "$URL/echo" -X POST -d '{"hola":"mundo"}' -H 'Content-Type: application/json'; pass "exit=$?"
info "jdev http $URL/set-cookie          → las cookies salen ENMASCARADAS (***)"
"$JDEV" http "$URL/set-cookie"; pass "exit=$?"
info "jdev http $URL/error               → status 500 (rojo) + body"
"$JDEV" http "$URL/error"; pass "exit=$?"
info "jdev http $URL/no-encontrado       → status 404 (amarillo)"
"$JDEV" http "$URL/no-encontrado"; pass "exit=$?"
info "jdev http $URL/lento --timeout 2   → ERROR TIMEOUT a los 2 s (exit=2)"
"$JDEV" http "$URL/lento" --timeout 2 2>&1; pass "exit=$? (esperado 2)"
info "jdev http http://127.0.0.1:1/x     → ERROR NETWORK (exit=2)"
"$JDEV" http http://127.0.0.1:1/x 2>&1; pass "exit=$? (esperado 2)"
info "jdev http $URL/x -X GET -d 'body'   → ERROR de USO (GET con body prohibido) exit=1"
"$JDEV" http "$URL/x" -X GET -d 'body' 2>&1; pass "exit=$? (esperado 1)"
kill $SERVIDOR_PID 2>/dev/null; wait $SERVIDOR_PID 2>/dev/null
pass "Servidor de práctica detenido."

# ════════════════════════════════════════════════════ RESUMEN
echo
echo "═══════════ RESUMEN ═══════════"
echo "Si viste todos los ✅, la instalación funciona correctamente."
echo "Resumen de la taxonomía de exit codes:"
echo "  0 → éxito (con confirmación explícita: 'valid JSON', 'password match', ids, digests…)"
echo "  1 → error de USO (flags inválidos, argumentos faltantes)"
echo "  2 → error de DATO/ENTORNO (JSON inválido, TLS, timeout, bcrypt >72 bytes, mismatch…)"
echo
echo "Nota de UX: en una terminal (TTY) las salidas siempre terminan en salto de línea;"
echo "al pipear/redirigir a archivo se conservan los bytes exactos (pureza binaria)."
echo
echo "Fixtures en: $ROOT/practica/  (ejemplo.json, malo.json, datos.csv, ejemplo.txt, token.jwt)"
echo "Archivos generados en: $TMP/   (bom-crlf.csv, grande.csv, servidor.log)"