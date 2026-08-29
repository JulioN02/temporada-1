# EXP-04 · Mini HTTP Framework

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: 💡 Idea

## Qué construyes

Un framework estilo Express desde cero:

- Router con métodos y params (`GET /users/:id`)
- Pipeline de middleware
- Manejo de errores
- Parsing de body y query

## Qué entiendes

- Qué hace Express por debajo cuando escribes `app.get('/users/:id', ...)`
- Orden de los middleware y cómo se encadenan
- Propagación de errores a través de la pila
- Montaje de routers

## Por qué

El mismo argumento que el Mini ORM: usas Express a diario. Demostrar que entiendes sus internals es la base para construir APIs con criterio y **depurar en serio**.

## Relación con otros experimentos

- CAPSTONE: un servicio del insignia podría correr sobre tu mini framework
- EXP-01 Mini lenguaje de consultas: parsing de query/body comparte lógica