# EXP-02 · Mini ORM

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: ✅ Implementado

## Qué construiste

Un mini ORM muy pequeño con operaciones básicas, construido sobre `node:sqlite`:

```
User.find()              → SELECT * FROM users
User.findById(1)         → SELECT * FROM users WHERE id = 1
User.create({...})       → INSERT INTO users ...
User.update(1, {...})    → UPDATE users SET ... WHERE id = 1
User.delete(1)           → DELETE FROM users WHERE id = 1
user.save()              → update desde una instancia (nunca inserta)
user.delete()            → delete desde una instancia
```

El descriptor de esquema es la única fuente de verdad: de él salen el nombre de la
tabla, la clave primaria y los tipos de cada columna. El ORM nunca adivina nada a
partir de los datos.

## Cómo funciona

Tres mecánicas, igual que en un ORM real:

- **Mapping**: declaras un descriptor (`createModel({ table, primaryKey, columns }, db)`)
  y el ORM lo usa para traducir tus llamadas a SQL. Cada columna tiene un tipo JS
  declarado (`int`, `float`, `string`, `bool`, `date`) y la coerción va en ambos
  sentidos: `true` se guarda como `1`, un `Date` se guarda como texto ISO-8601 UTC,
  `null` queda como `NULL`. El ORM nunca deduce un tipo desde el valor almacenado.
- **Query generation**: cada método produce dos salidas: el texto SQL (con
  identificadores que salen **solo** del descriptor) y los bindings (los valores del
  usuario, **solo** como parámetros `?`). Como los valores nunca se interpolan en el
  SQL, la inyección es imposible por construcción — hay un test que lo demuestra con
  `Robert'); DROP TABLE users;--`.
- **Hydration**: cada fila cruda (que `node:sqlite` devuelve como objeto sin
  prototipo) se copia a una instancia real de la clase del modelo, con los tipos ya
  convertidos. Cada consulta devuelve instancias frescas: no hay identity map, dos
  lecturas de la misma fila comparten valor pero no identidad.

Semántica deliberadamente pequeña (axioma 5): un método por sentencia DML, sin
operadores de consulta, sin relaciones ni transacciones. La semántica SQL la decide
la base de datos (axioma 3): por ejemplo, sin `orderBy` el orden de `find()` es
indefinido. La ausencia es estado normal: `findById` → `null`, `find` → `[]`,
`update` → `null`, `delete` → `false`.

Los axiomas del plan de desarrollo que este experimento ejercita: 2 (inyección
imposible por construcción), 3 (la BD decide la semántica SQL), 4 (descriptor como
única fuente de verdad), 5 (API deliberadamente pequeña) y 8 (conexión única
síncrona).

## Cómo ejecutar

```bash
npm install
npm test          # suite completa con node --test
npm run typecheck # tsc --noEmit (TS strict)
```

Ejemplo rápido (base en memoria, sin dependencias externas):

```ts
import { DatabaseSync } from 'node:sqlite';
import { createModel } from './src/model.ts';

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER)`);

const User = createModel(
  {
    table: 'users',
    primaryKey: 'id',
    columns: { id: 'int', name: 'string', active: 'bool' },
  },
  db,
);

const ana = User.create({ name: 'Ana', active: true });
console.log(ana.id, ana.name, ana.active); // 1 'Ana' true

ana.name = 'Ana María';
ana.save();                                // update-only: true

console.log(User.find({ where: { active: true } }).length); // 1
```

## Qué entendiste

Cómo funcionan realmente los ORMs, ahora con la implementación en la mano:

- **Mapping**: del registro de la base al objeto de tu lenguaje
- **Query generation**: construir SQL a partir de llamadas de método
- **Hydration**: poblar objetos desde filas y viceversa

## Por qué

Es **fundamental**: la base para construir muchos productos distintos. Demostrar que
entiendes una herramienta que usas a diario vale más que enumerarla en un CV.

## Relación con otros experimentos

- EXP-01 Mini lenguaje de consultas: la generación de consultas se apoya en el mismo razonamiento
- CAPSTONE: el mini-ORM puede ser la capa de acceso a datos del proyecto insignia