#!/usr/bin/env bash
# check-espanol-neutro.sh — Falla si se detecta voseo/rioplatense en los archivos.
#
# Uso:
#   scripts/check-espanol-neutro.sh                # escanea el repo (incl. repos anidados)
#   scripts/check-espanol-neutro.sh /ruta/otra     # escanea otra ruta
#
# Exit code: 0 = español neutro OK · 1 = voseo detectado (imprime los matches).
# Pensado para correr en pre-commit, CI o como guard del orquestador.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("$ROOT")
fi

# Marcadores de voseo / rioplatense (presente, imperativo, subjuntivo, clíticos, slang).
PATTERN='\b(vos|tenés|querés|podés|sabés|decís|hacés|venís|sos|andás|tené|hacé|mirá|fijate|dale|che|andá|usá|creá|probá|ejecutá|corré|cambiá|borrá|agregá|actualizá|revisá|verificá|instalá|configurá|descargá|subí|poné|sacá|dejá|empezá|terminá|seguí|escribí|leé|abrí|cerrá|copiá|pegá|contá|decime|dame|avisá|mandá|tomá|comé|arrancá|tirá|vení|salí|pedí|elegí|repetí|pasame|traeme|dejame|ayudame|mostrame|llamame|avisame|hablá|escuchá|pensá|armá|levantá|guardá|mové|eliminá|modificá|editá|validá|chequeá|logueate|registrate|tengás|puedás|hagás|vengás|sepás|quierás|digás|veás|pongás|salgás|olvidate|animate|metele|sumate|anotate|sacate|ponete|andate|venite|quedate|enterate|acordate|avisale|decile|mandale|boludo|boluda|capo|posta|laburo|quilombo|bardo|copado|pibe|guita|trucho|chamuyo|facha|fiaca)\b'

# Excluye .git, node_modules, pgdata y .obsidian; --no-ignore para incluir repos anidados.
EXCLUDES=(--no-ignore --hidden -g '!**/.git/**' -g '!**/node_modules/**' -g '!**/pgdata/**' -g '!**/.obsidian/**')

# Allowlist: jdev/tests/tui.test.ts contiene 'querés'/'podés' INTENCIONALMENTE
# como valores de aserción (es el test que PROHÍBE el voseo en el TUI).
# Este mismo script también contiene los marcadores en su PATTERN (legítimo: es el guard).
ALLOW="herramientas/jdev/tests/tui.test.ts
scripts/check-espanol-neutro.sh"

MATCHES="$(rg -i -n "${EXCLUDES[@]}" "$PATTERN" "${TARGETS[@]}" 2>/dev/null | grep -vF "$ALLOW")"

if [ -n "$MATCHES" ]; then
  echo "❌ Voseo/rioplatense detectado en español neutro:" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "✅ Español neutro OK — sin voseo."
exit 0