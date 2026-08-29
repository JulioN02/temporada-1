# EXP-05 · Mini Storage Engine

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: 🔲 Pendiente (idea)

## Qué construyes

Un mini motor de almacenamiento estilo SQLite:

- Log **append-only** (WAL) para escrituras
- Índice **en memoria** para lecturas
- **Persistencia y recovery** al reiniciar (reconstruir el estado desde el log)
- Extensión opcional: índice **B-tree** en disco

## Qué entiendes

- Cómo se almacenan los datos físicamente
- Por qué los WAL hacen rápidas las escrituras (append secuencial)
- Cómo se reconstruye el estado tras un reinicio
- Por qué PostgreSQL hace lo que hace a nivel de almacenamiento

## Por qué

Alineado con la identidad **Systems-oriented**: el storage es la base de todo producto. Entenderlo por dentro explica el comportamiento de cualquier base de datos que uses.

## Relación con otros experimentos

- EXP-03 Mini Message Queue: ambas requieren persistencia y recovery
- CAPSTONE: puede servir como persistencia del insignia
- Conecta con Temporada 8 (Systems Engineering)