# EXP-04 · Mini HTTP Framework

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: ✅ Implementado

## Qué construiste

Un framework HTTP estilo Express 5 desde cero, en TypeScript con cero dependencias
(`node:http` + `node:querystring`), con la API pública fiel a Express 5:

```ts
const app = express();

app.use(json());                                  // body parser (límite configurable)
app.use('/api', router);                          // montaje de routers
app.get('/users/:id', (req, res) => {             // params + query eager
  res.json({ id: req.params.id, q: req.query.q });
});
app.listen(3000);
```

La superficie pública: `use`, `get`/`post`/`put`/`patch`/`delete`, `all`, `listen` y
`handle`. El dispatch en memoria (`app.handle(req, res)`) es el mecanismo de testeo
primario; `listen()` envuelve `http.createServer` para HTTP real.

## Cómo funciona

Cinco mecánicas, igual que en Express:

- **La app ES un router**: `express()` compone un `Router` con una sola pila FIFO de
  capas. `use()` y `app.METHOD()` agregan capas a la misma pila; el routing es
  middleware. Cada capa compila su path a un RegExp en el constructor (`:name` →
  captura de un segmento, decodificada en `req.params`).
- **`next()` es el único primitivo de flujo**: un handler decide continuar (`next()`),
  propagar un error (`next(err)`), saltar el resto de la ruta (`next('route')`) o
  abandonar el router (`next('router')`). Responder sin llamar `next()` corta el
  pipeline (short-circuit).
- **Errores por aridad**: un middleware de error se detecta por `fn.length === 4`
  (`(err, req, res, next)`). `next(err)` salta las capas normales y corre la siguiente
  de aridad 4; sin ninguna, el `finalhandler` responde 404, el status del `HttpError`,
  o 500 genérico (el mensaje crudo nunca se expone).
- **Montaje con trimPrefix**: `app.use('/api', router)` recorta el prefijo de
  `req.url` (conservando el query), concatena `req.baseUrl` y restaura ambos al
  desenrollar; `req.originalUrl` nunca se muta. Los montajes anidados concatenan
  `baseUrl`.
- **Query simple eager**: `req.query` se puebla una sola vez al entrar el request con
  `node:querystring` (`+` → espacio, `%`-decode, claves repetidas → array); nunca es
  un getter. El body es middleware: `json()`/`urlencoded()` con límite (100kb por
  defecto, configurable con `{limit}`) y guard de re-lectura.

Simplificaciones deliberadas (documentadas en el spec): `res.send(string)` usa
`text/plain; charset=utf-8` (Express usa `text/html`), sin header `Allow` en el 404
por método (contrato O1: método que no matchea → 404), sin auto-wrap de promesas
rechazadas (los errores async van por `next(err)` explícito) y `HEAD` a una ruta
solo-GET cae en 404.

## Cómo ejecutar

```bash
npm install
npm test          # suite completa con node --test
npm run check     # tsc --noEmit (TS strict)
```

Ejemplo rápido:

```ts
import express from './src/app.ts';
import { json } from './src/middleware/json.ts';

const app = express();
app.use(json());
app.post('/echo', (req, res) => res.json({ body: req.body }));

app.listen(3000, () => console.log('listening on 3000'));
// curl -X POST localhost:3000/echo -H 'content-type: application/json' -d '{"a":1}'
```

Evidencia: **34/34 escenarios del spec (R1–R15) verdes** + 2 locks P2 opcionales
(R8-S4 límite 413, R2-S3 trailing slash) = **36 tests**, todos con `node --test`, y
`tsc --noEmit` limpio. La paridad fake↔real se valida en R15-S1 con `app.listen(0)` +
`fetch` global: status, Content-Type y body idénticos para routes+params, body json,
body urlencoded, query, montaje, 404 y 500.

## Qué entendiste

Cómo funciona Express por debajo cuando escribes `app.get('/users/:id', ...)`:

- El routing es middleware: una sola pila de capas, sin máquinas separadas
- `next()` como primitivo: continuar, propagar, saltar ruta o saltar router
- La aridad como detección: los errores son middlewares de 4 parámetros
- Montaje: recortar el prefijo, concatenar `baseUrl`, restaurar al salir
- Parsing: body como middleware con límite y guard de re-lectura; query eager

## Por qué

Es **fundamental**: demuestra que entiendes los internals de la herramienta que usas
a diario para construir APIs. Depurar en serio un framework requiere saber qué hace
por debajo.

## Relación con otros experimentos

- EXP-01 Mini lenguaje de consultas: el parsing de query/body comparte lógica
- EXP-02 Mini ORM: mismo patrón de experimento (spec → diseño → TDD estricto)
- CAPSTONE: un servicio del insignia podría correr sobre tu mini framework