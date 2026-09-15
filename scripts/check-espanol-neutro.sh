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

# ── Patrón 1: voseo con tilde + clíticos + subjuntivo + slang inequívoco (case-insensitive:
#    se EXCLUYEN ambiguas con inglés/español neutro: animate/posta/bardo/guita/trucho/facha/capo/pibe/che/dale/copado) ──
PAT1='\b(tenés|querés|podés|sabés|decís|hacés|venís|andás|tené|hacé|mirá|fijate|andá|usá|creá|probá|ejecutá|corré|cambiá|borrá|agregá|actualizá|revisá|verificá|instalá|configurá|descargá|subí|poné|sacá|dejá|empezá|terminá|seguí|escribí|leé|abrí|cerrá|copiá|pegá|contá|decime|avisá|mandá|tomá|comé|arrancá|tirá|vení|salí|pedí|elegí|repetí|pasame|traeme|dejame|ayudame|mostrame|llamame|avisame|hablá|escuchá|pensá|armá|levantá|guardá|mové|eliminá|modificá|editá|validá|chequeá|logueate|registrate|tengás|puedás|hagás|vengás|sepás|quierás|digás|veás|pongás|salgás|olvidate|metele|sumate|anotate|sacate|ponete|andate|venite|quedate|enterate|acordate|avisale|decile|mandale|boludo|boluda|laburo|quilombo|chamuyo|fiaca)\b'

# ── Patrón 2: ambiguos SOLO en minúscula (evita "SOS" sigla, "VOS" acrónimo) ──
PAT2='\b(vos|sos)\b'

# Excluye .git, node_modules, pgdata y .obsidian; --no-ignore para incluir repos anidados.
EXCLUDES=(--no-ignore --hidden -g '!**/.git/**' -g '!**/node_modules/**' -g '!**/pgdata/**' -g '!**/.obsidian/**')

# Allowlist: jdev/tests/tui.test.ts contiene 'querés'/'podés' INTENCIONALMENTE
# como valores de aserción (es el test que PROHÍBE el voseo en el TUI).
# Este mismo script también contiene los marcadores en su PATTERN (legítimo: es el guard).
ALLOW='tui\.test\.ts|check-espanol-neutro\.sh'

MATCHES="$(rg -i -n "${EXCLUDES[@]}" "$PAT1" "${TARGETS[@]}" 2>/dev/null; rg -n "${EXCLUDES[@]}" "$PAT2" "${TARGETS[@]}" 2>/dev/null | grep -vE "$ALLOW" || true)"

# Filtrar también PAT1 contra la allowlist (el test/script aparecen en PAT1 con -i)
if [ -n "$MATCHES" ]; then
  MATCHES="$(printf '%s' "$MATCHES" | grep -vE "$ALLOW" || true)"
fi

if [ -n "$MATCHES" ]; then
  echo "❌ Voseo/rioplatense detectado en español neutro:" >&2
  printf '%s' "$MATCHES" >&2
  exit 1
fi

echo "✅ Español neutro OK — sin voseo."
exit 0