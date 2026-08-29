# EXP-03 · Mini Message Queue

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: 🔲 Pendiente (idea)

## Qué construyes

Un broker pequeño pero real:

- Colas **persistentes en disco** (sobreviven reinicios)
- Topics
- Consumidores con **ack**
- **Redelivery** de mensajes fallidos
- **Consumer groups**
- Replay desde un offset

Como warm-up, el primer módulo interno puede ser un event bus en memoria (`emit`/`on`).

## Qué entiendes

- Por qué un `emit` en memoria **no es suficiente** para sistemas async reales
- Garantías de entrega (**at-least-once**) y sus costos
- Cómo las colas sobreviven a reinicios
- Cómo escalan los consumidores (particiones y grupos)

## Por qué

Es la base de los sistemas de **jobs y workers**. Entenderlo por dentro se conecta con:

- **Workflow Engine** (proyecto profesional) — jobs y workers
- **CAPSTONE** — procesamiento de trabajos
- **LAB-06 Background Jobs** y **LAB-07 Retry/Failure**
- **Temporada 6** — sistemas distribuidos

## Relación con otros experimentos

- Reemplaza al anterior Mini Event Bus: el broker lo absorbe como módulo interno
- CAPSTONE: la message queue puede orquestar los jobs del insignia