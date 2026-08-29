# LAB-08 — Pista de Auditoría (Audit Trail)

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Este README es la introducción del laboratorio: definición, hipótesis y plan de experimentos.
> **Estado**: 🔲 Pendiente — lo desarrollo yo (revisar, ejecutar, medir, documentar).

## Problema

El stock dio negativo, un precio cambió de la nada, un usuario borró un registro
crítico "sin darse cuenta". Alguien quiere saber: **quién hizo qué, cuándo, y
cómo estaba el dato antes y después**. La tabla actual solo guarda el estado
final — si nadie anotó el cambio, es imposible reconstruir la historia. Sin un
registro de auditoría, los sistemas empresariales son cajas negras: no se puede
investigar un incidente, cumplir con una auditoría externa ni responder "¿qué
pasó con este movimiento?".

Guardar "el estado actual" no alcanza; la historia es **irreconstruible** si no
se captura en el momento del cambio. Necesitamos una pista de auditoría: un
registro **inmutable y append-only** que documente quién (actor), qué (acción),
sobre qué recurso, cuándo (timestamp), y el **antes/después** de la operación.
Las preguntas clásicas de diseño: ¿lo registramos **a nivel de aplicación**
(código que escribe además de la fila) o **con triggers** (la base se asegura,
nos guste o no)? ¿Guardamos `before`/`after` como JSON? ¿Cómo consultamos el
historial y reconstruimos el estado en un momento T? ¿Y cómo garantizamos que
la pista no se pueda *editar* (append-only) sin renunciar a operaciones de
borrado por seguridad?

El lab consiste en implementar una tabla de auditoría, capturar before/after en
updates con ambos enfoques (application-level y/o triggers), consultar el
historial, reconstruir estado en un momento dado y discutir — con mediciones —
el costo de cada diseño.

## Objetivo del lab

Diseñar e implementar una pista de auditoría para operaciones críticas:
entender el modelo de datos (actor, acción, recurso, timestamp, before/after
JSON), comparar registro a nivel de aplicación vs. triggers en la base,
aprender a consultar el historial y reconstruir el estado en un momento T, y
razonar sobre la inmutabilidad (append-only vs. UPDATE) del registro.

## Hipótesis

Antes de correr los experimentos, las expectativas son:

1. **Sin auditoría no hay historia**: ante un cambio (ej. un UPDATE de stock), la
   tabla sola no permite saber quién lo hizo ni cómo estaba el dato antes — el
   punto de partida que este lab resuelve.
2. **Registrar a nivel de aplicación funciona pero se puede olvidar**: si el
   código de escritura también inserta en la tabla de auditoría, hay que ser
   disciplinado en **cada punto de escritura**; es fácil de entender y darle
   formato por dominio, pero si un flujo escribe sin registrar, la pista queda
   parcial (huecos).
3. **Los triggers no se olvidan**: con un trigger en la base, **todo** UPDATE de
   la tabla crítica deja su rastro, incluso los que la aplicación olvide (o
   scripts de mantenimiento). Costo: menos flexibilidad de formato y un poco de
   latencia extra por escritura (medible).
4. **El before/after hace consultable la historia**: con `before`/`after` en
   JSON se puede reconstruir el estado de un registro en cualquier momento T
   (aplicando los cambios en orden) y responder "¿qué cambio vino antes de X?".
   Hipótesis: los queries de historial son simples pero requieren buen indexado
   por recurso + timestamp.
5. **La inmutabilidad es un diseño, no un accidente**: si la tabla de auditoría
   permite UPDATE/DELETE, la pista no es confiable; la integridad requiere un
   registro **append-only** (restringir UPDATE/DELETE en la base, o
   aplicarlo por convención + defensa en capas de base de datos).

## Plan de experimentos

- Exp 1: **Sin auditoría (baseline)** — realizar una operación crítica (UPDATE
  con cambio de stock) y demostrar que el estado anterior no se puede recuperar.
- Exp 2: **Auditoría a nivel de aplicación** — registro manual en la tabla de
  auditoría desde el código de escritura; capturar actor/acción/recurso/
  timestamp y before/after; verificar que el historial queda completo en los
  flujos instrumentados.
- Exp 3: **Triggers en la base** — trigger `AFTER UPDATE` que registra
  automáticamente; verificar que registra incluso escrituras que el código
  "olvidó" instrumentar; medir el costo de latencia por escritura.
- Exp 4: **Consulta del historial + reconstrucción en T** — consultas
  "¿quién tocó este registro y cuándo?" y reconstrucción del valor en un
  momento pasado a partir de la secuencia de cambios.
- Exp 5: **Inmutabilidad** — intentar UPDATE/DELETE sobre la pista y demostrar
  (según el diseño elegido) que se bloquea o que hay que salvaguardas; medición
  del costo de escritura en storage/append-only vs. edición.

## Temas a explorar

- Diseño de la tabla de auditoría: actor, acción, recurso, timestamp, `before`/`after` JSON
- Application-level vs. triggers: cobertura, formato, latencia, riesgo de olvido
- Consultar historial y reconstrucción de estado en un momento T
- Inmutabilidad y append-only: restricciones, UPDATE vs. nuevo registro
- Indexado del historial (recurso + timestamp) para queries de auditoría
- Vínculo con LAB-01/02: auditoría de movimientos + idempotencia de los registros

## Estructura esperada

```
lab-08-audit-trail/
├── package.json          # scripts: test, typecheck, exp:*, db:setup
├── tsconfig.json         # TS strict, ESM (nodenext), erasableSyntaxOnly
├── migrations/
│   └── 001_schema.sql    # tabla crítica + tabla de auditoría (+ trigger)
├── src/
│   ├── db.ts             # conexión local, reset, helpers
│   ├── audit.ts          # registro a nivel de aplicación
│   ├── trigger.sql       # (si aplica) trigger AFTER UPDATE/UPSERT
│   ├── exp-01-nobaseline.ts # sin auditoría: estado anterior no recuperable
│   ├── exp-02-applevel.ts  # auditoría desde el código
│   ├── exp-03-trigger.ts   # auditoría por trigger de la base
│   ├── exp-04-history.ts   # consultas + reconstrucción en T
│   └── exp-05-immutable.ts # append-only vs. edición
├── tests/
│   └── audit.test.ts     # invariantes: rastro completo, immutabilidad, reconstrucción
└── docs/
    ├── output-01-baseline.txt
    ├── output-02-applevel.txt
    ├── output-03-trigger.txt
    ├── output-04-history.txt
    ├── output-05-immutable.txt
    └── output-test.txt
```

## Cómo ejecutar este lab (una vez desarrollado)

Siguiendo el patrón del LAB-01 (servidor PostgreSQL local, nunca docker):

```bash
createdb lab_audit_trail
npm run db:setup           # aplicar migrations + trigger + verificar esquema
npm install                # solo pg + types (TypeScript nativo, sin build)

npm run exp:baseline       # Exp 1
npm run exp:applevel       # Exp 2
npm run exp:trigger        # Exp 3
npm run exp:history        # Exp 4
npm run exp:immutable      # Exp 5

npm test                   # invariantes con node:test
npm run typecheck          # tsc --noEmit (TS strict)
```

Correr los experimentos **de a uno, secuencialmente** (comparten tablas; no
lanzarlos en paralelo — gotcha del LAB-01). Capturar cada salida en
`docs/output-*.txt` como evidencia real.

## Cómo se conecta con el plan

LAB-08 alimenta el módulo de **Inventory & Stock Management** (auditoría de
cada movimiento de stock, quién lo hizo y cómo estaba el stock antes/después)
y define un estándar transversal para **todos los proyectos empresariales**: la
capacidad de responder "quién hizo qué, cuándo y sobre qué valor" deja de ser
un lujo y se vuelve requisito. Se apoya en LAB-01 y LAB-02 (la pista de
movimientos debe registrarse de forma consistente e idempotente); junto a ellos
forma el primer bloque de infraestructura de datos del plan.

## Criterio de completado

- [ ] Documentar problema, hipótesis y plan en este README (sección mediciones completadas)
- [ ] Tabla de auditoría implementada (actor, acción, recurso, timestamp, before/after JSON)
- [ ] Ambos enfoques medidos: nivel de aplicación y triggers (cobertura + costo)
- [ ] Evidencia real en `docs/output-*.txt`: historial, reconstrucción en T, inmutabilidad
- [ ] Invariante verificado con tests: rastro completo, append-only respetado, reconstrucción correcta
- [ ] Conclusión documentada: cuándo aplicación vs. trigger, cómo indexar y garantizar inmutabilidad
- [ ] `npm run typecheck` limpio