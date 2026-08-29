# Experimentos

Darse permiso de hacer cosas "raras": entender por dentro lo que usas todos los días. Documentación en Obsidian → `Experimentos/Experimentos.md`.

> Esta categoría existe para que **no todo tenga que ser comercialmente justificable**. Si aprendes algo raro y profundo, el experimento valió la pena.

## Reglas

- No necesitan justificación comercial
- Deben ser **pequeños** (días, no semanas)
- Lo importante es **la comprensión que dejan**, no el entregable

## Experimentos

| # | Experimento | Qué construyes | Qué entiendes | Estado |
|---|---|---|---|---|
| EXP-01 | **Mini lenguaje de consultas** | Algo como `users where age > 20` convertido a SQL | parsing, tokens, AST, interpretación | 💡 |
| EXP-02 | **Mini ORM** | `User.find()`, `User.findById()`, `User.create()` muy pequeños | cómo funcionan realmente los ORMs | 💡 |
| EXP-03 | **Mini Message Queue** | Broker pequeño: colas persistentes en disco, topics, ack, redelivery, consumer groups | por qué un `emit` en memoria no basta para sistemas async; entrega at-least-once | 💡 |
| EXP-04 | **Mini HTTP Framework** | Framework estilo Express desde cero: router, middleware, errores, parsing de body/query | qué hace Express por debajo cuando escribes `app.get('/users/:id', ...)` | 💡 |
| EXP-05 | **Mini Storage Engine** | Motor de almacenamiento estilo SQLite: WAL + índice en memoria + recovery | cómo se almacenan los datos físicamente, por qué los WAL hacen rápidas las escrituras | 💡 |

## Nota sobre el set

El set fue actualizado: **Mini Event Bus**, **Mini API Gateway** y **Distributed ID Generator** fueron reemplazados (archivados en el backlog) por considerarse demasiado triviales o poco rentables en tiempo. Los tres nuevos siguen la misma lógica que el Mini ORM: entender lo que usas a diario es la base.

## Uso

Lo aprendido en los experimentos **se integra en el capstone** (Business Operations Platform): la message queue, el mini-framework, el mini-ORM, el lenguaje de consultas o el storage engine pueden aparecer dentro del proyecto insignia.