# LAB-06 — Trabajos en Segundo Plano (Background Jobs)

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Este README es la introducción del laboratorio: definición, hipótesis y plan de experimentos.
> **Estado**: 🔲 Pendiente — lo desarrollo yo (revisar, ejecutar, medir, documentar).

## Problema

La API recibe un pedido: "generá 10.000 PDFs" (facturas, reportes, extractos).
Si el endpoint hace el trabajo adentro de la misma petición HTTP, el usuario
queda esperando minutos, la conexión se corta por timeout, y si el proceso cae
a la mitad, el trabajo se pierde completo. Un trabajo pesado y síncrono
bloquea la API — y bloquea también a todos los demás usuarios que llegan
después.

La solución es pasar el trabajo **a un segundo plano**: la API acepta la
tarea, responde "recibido, te aviso" de inmediato (202 Accepted), encola el
trabajo y vuelve a atender request a request. Un **worker** (o varios) toma los
trabajos de la cola y los ejecuta en paralelo, fuera del ciclo de vida de la
petición. Pero esto introduce un modelo nuevo: el trabajo ahora tiene un
**ciclo de vida** propio (pending → processing → done/failed), hay que
persistirlo para que no se pierda si el proceso cae, y hay que decidir qué
pasa si un worker muere a mitad de una tarea (¿reintento? ¿reintento otra vez?
¿otra vez?).

El lab consiste en construir una cola de trabajo mínima por encima de
PostgreSQL (la tabla es la cola) y medir el paso de "la API bloquea" a "la API
responde al instante y N workers procesan en paralelo", incluyendo el manejo
de fallos y el reencolado.

## Objetivo del lab

Entender la arquitectura API → Queue → Worker → Task: desacoplar la petición
del trabajo pesado, modelar la máquina de estados del job
(pending/processing/done/failed), escalar con múltiples workers (concurrencia)
y decidir la semántica de entrega (at-least-once vs. at-most-once) para trabajos
que no pueden perderse.

## Hipótesis

Antes de correr los experimentos, las expectativas son:

1. **Generación síncrona bloquea**: si el endpoint hace el trabajo pesado
   adentro de la petición, el tiempo de respuesta es igual al tiempo de
   procesamiento (p. ej. N segundos) y la API no atiende a nadie más durante
   eso — el baseline que queremos eliminar.
2. **Queue + worker desacopla**: con la cola, el endpoint responde en
   milisegundos (solo inserta el job) y el worker procesa después; la latencia
   de la petición deja de depender del trabajo.
3. **Más workers = más throughput**: con 1 worker el tiempo total es
   `sum(tareas) / 1`; con 3-5 workers baja casi linealmente (salvo contención
   de la base), y se puede medir la mejora de tiempo total con la misma carga.
4. **Un job no es solo su ejecución**: el job necesita estado persistido
   (pending/processing/done/failed) para sobrevivir caídas; un worker que
   muere deja un job en `processing` que **debe volver a `pending`** (lease /
   timeout) o se pierde para siempre.
5. **La semántica importa**: sin cuidado, la entrega es **at-least-once**
   (tarea puede ejecutarse 2+ veces → requiere idempotencia, como en LAB-02);
   lograr exactly-once requiere deduplicación, no solo "procesar". Medir esto
   define qué diseño es correcto para 10.000 PDFs.

## Plan de experimentos

- Exp 1: **Línea base síncrona** — endpoint que genera N trabajos (simulados:
  sleep + trabajo) dentro de la petición; medir tiempo de respuesta y que la
  API queda bloqueada.
- Exp 2: **Queue + worker simple** — tabla de jobs, endpoint que inserta y
  responde 202 al instante, 1 worker que drena la cola; medir respuesta rápida
  + tiempo total de procesamiento.
- Exp 3: **Múltiples workers (concurrencia)** — 1 vs. 3 vs. 5 workers con la
  misma carga (p. ej. 10.000 tareas); medir tiempo total y rate de
  procesamiento.
- Exp 4: **Fallos y reencolado** — jobs que fallan (base de la tarea: error
  simulado) pasan a `failed` o se reencolan; trabajador que "muere" a mitad de
  `processing` y su job vuelve a `pending` por timeout (lease).
- Exp 5 (opcional): **Estados y observabilidad** — maquinar la transición
  pending → processing → done/failed con timestamps, y contar exactamente cuántas
  veces se ejecutó cada tarea (para ilustrar at-least-once vs. exactly-once).

## Temas a explorar

- Arquitectura API → Queue → Worker → Task (cola por tabla PostgreSQL)
- Máquina de estados del job: pending / processing / done / failed
- Semánticas de entrega: at-least-once, at-most-once y la ilusión de exactly-once
- Lease/claim de jobs (`FOR UPDATE SKIP LOCKED`) y reencolado de huérfanos
- Concurrencia de workers (escalado horizontal) y contención real
- Vínculo con LAB-02: trabajos reejecutados necesitan idempotencia
- Vínculo con CAPSTONE: jobs de integración y generación de documentos

## Estructura esperada

```
lab-06-background-jobs/
├── package.json          # scripts: test, typecheck, exp:*, db:setup
├── tsconfig.json         # TS strict, ESM (nodenext), erasableSyntaxOnly
├── migrations/
│   └── 001_schema.sql    # tabla jobs (estado, payload, lease, timestamps)
├── src/
│   ├── db.ts             # conexión local, reset, helpers
│   ├── queue.ts          # enqueue, claim (FOR UPDATE SKIP LOCKED), markDone/Failed
│   ├── worker.ts         # loop de worker (claims + procesa)
│   ├── task.ts           # tarea simulada (generación de "documentos")
│   ├── exp-01-sync.ts        # API bloqueante (baseline)
│   ├── exp-02-queue.ts       # API + 1 worker
│   ├── exp-03-workers.ts     # 1 vs 3 vs 5 workers
│   └── exp-04-failure.ts     # fallos, reencolado y lease timeout
├── tests/
│   └── jobs.test.ts      # invariantes: estados, reencolado, at-least-once
└── docs/
    ├── output-01-sync.txt
    ├── output-02-queue.txt
    ├── output-03-workers.txt
    ├── output-04-failure.txt
    └── output-test.txt
```

## Cómo ejecutar este lab (una vez desarrollado)

Siguiendo el patrón del LAB-01 (servidor PostgreSQL local como cola, nunca
docker):

```bash
createdb lab_background_jobs
npm run db:setup           # aplicar migrations + verificar esquema
npm install                # solo pg + types (TypeScript nativo, sin build)

npm run exp:sync           # Exp 1: API bloqueante
npm run exp:queue          # Exp 2: cola + 1 worker
npm run exp:workers        # Exp 3: concurrencia de workers
npm run exp:failure        # Exp 4: fallos + reencolado

npm test                   # invariantes con node:test
npm run typecheck          # tsc --noEmit (TS strict)
```

Correr los experimentos **de a uno, secuencialmente** (comparten la tabla de
jobs; no lanzarlos en paralelo — gotcha del LAB-01). Capturar cada salida en
`docs/output-*.txt` como evidencia real.

## Cómo se conecta con el plan

LAB-06 alimenta el módulo de **Workflow Automation Engine** — su pipeline
EVENT → RULE → ACTION es, en esencia, un sistema de cola y workers: cada
acción (notificar, generar, integrar) debe encolarse y procesarse fuera del
request sin bloquear la API — y es pieza clave del **CAPSTONE**, donde los
jobs de integración y generación de documentos son parte del producto. Lo
aprendido acá (estados, claim, reencolado, idempotencia) es la infraestructura
de ese motor.

## Criterio de completado

- [ ] Documentar problema, hipótesis y plan en este README (sección mediciones completada)
- [ ] Cola + worker implementados sobre PostgreSQL (tabla como cola, claim con `SKIP LOCKED`)
- [ ] Mediciones con evidencia real en `docs/output-*.txt`: baseline síncrono, 1/N workers, fallos
- [ ] Invariante verificado con tests: nadie pierde jobs, huérfanos se reencolan, estados consistentes
- [ ] Conclusión documentada: semántica de entrega (at-least-once + idempotencia) y escalado de workers
- [ ] `npm run typecheck` limpio