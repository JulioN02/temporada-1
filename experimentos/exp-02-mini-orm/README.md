# EXP-02 · Mini ORM

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: 💡 Idea

## Qué construyes

Un mini ORM muy pequeño con operaciones básicas:

```
User.find()        → SELECT * FROM users
User.findById(1)   → SELECT * FROM users WHERE id = 1
User.create({...}) → INSERT INTO users ...
```

## Qué entiendes

Cómo funcionan realmente los ORMs:

- **Mapping**: del registro de la base al objeto de tu lenguaje
- **Query generation**: construir SQL a partir de llamadas de método
- **Hydration**: poblar objetos desde filas y viceversa

## Por qué

Es **fundamental**: la base para construir muchos productos distintos. Demostrar que entiendes una herramienta que usas a diario vale más que enumerarla en un CV.

## Relación con otros experimentos

- EXP-01 Mini lenguaje de consultas: la generación de consultas se apoya en el mismo razonamiento
- CAPSTONE: el mini-ORM puede ser la capa de acceso a datos del proyecto insignia