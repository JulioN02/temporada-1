# LAB-05 — Caching (Almacenamiento en Caché)

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Este README es la introducción del laboratorio: definición, hipótesis y plan de experimentos.
> **Estado**: 🔲 Pendiente — lo desarrollo yo (revisar, ejecutar, medir, documentar).

## Problema

Un endpoint de solo lectura (p. ej. "resumen de stock", "reporte de ventas",
"perfil del usuario") es consultado miles de veces por minuto. Cada request
pega contra la base de datos, ejecuta la misma consulta una y otra vez, y la
base empieza a competir con las escrituras reales del sistema. El resultado:
latencia alta, base saturada y costos innecesarios — para devolver siempre lo
mismo.

La respuesta obvia es **caché**: guardar el resultado y servirlo sin volver a
la base. Pero guardar y servir es la parte fácil. Lo difícil es la
**invalidación**: si un dato cambia (un movimiento de stock), la copia en caché
queda vieja (stale) y el usuario lee información desactualizada. ¿Cuándo
invalidamos? ¿Cada cuánto expira (TTL)? ¿Invalidamos al escribir, o dejamos
que expire sola? ¿Qué tan aceptable es que un reporte tenga 30 segundos de
atraso?

Además hay que elegir *dónde* guardar: PostgreSQL mismo (¿por qué no?),
memoria en el proceso Node (un `Map`), o un caché externo. Cada opción tiene un
costo distinto en latencia, consistencia y vida útil. El lab consiste en
construir un endpoint de lectura con tres variantes — base directa, caché
con TTL, caché con invalidación por escritura — y medir la diferencia con
números.

## Objetivo del lab

Implementar un patrón de caché típico (cache-aside con TTL y, opcionalmente,
write-through/invalidación por escritura), medir la mejora de latencia frente a
golpear la base en cada request, entender los trade-offs de datos viejos vs.
velocidad, y decidir con datos dónde conviene cachear y qué invalidar.

## Hipótesis

Antes de correr los experimentos, las expectativas son:

1. **Línea base sin caché**: cada request ejecuta la consulta en PostgreSQL;
   la latencia es la del round-trip real a la base (p. ej. ms a decenas de ms)
   y la base recibe 1 consulta por request.
2. **Cache-aside con TTL**: el primer request carga el caché y los siguientes
   se sirven desde memoria — la latencia debería caer **un orden de magnitud o
   más** (de ms a microsegundos) y la base deja de recibir casi todas las
   consultas (hit ratio alto).
3. **La invalidación es el costo oculto**: con TTL puro hay una ventana de
   **stale data** (el dato cambia, la caché sigue sirviendo el viejo hasta que
   expira). Invalidar por escritura la cierra, pero obliga a que el escritor
   conozca y actualice la caché (más acoplamiento y riesgo de bugs).
4. **El hit ratio y la latencia van juntos**: a mayor hit ratio, menor
   latencia promedio — y la tabla de medición debería mostrarlo con datos
   (hit ratio %, latencia avg/p95, requests a la base).
5. **PostgreSQL como caché es viable pero más lento**: servir desde una tabla
   en PG es más rápido que recomputar la consulta, pero sigue siendo un
   round-trip a la base; la caché en memoria del proceso Node es la más rápida
   y la que menos satura la base.

## Plan de experimentos

- Exp 1: **Línea base** — endpoint de lectura que consulta PostgreSQL en cada
  request (sin caché). Medir latencia avg/p95 y requests a la base.
- Exp 2: **Cache-aside con TTL** — caché en memoria (Map) con TTL; medir
  primer request (miss), siguientes (hits), hit ratio y latencia.
- Exp 3: **Invalidación por escritura** — un endpoint de escritura que invalida
  (o actualiza) la entrada en caché al modificar el dato; medir que el lector
  vea el dato nuevo sin esperar el TTL.
- Exp 4: **Medición consolidada** — tabla de comparación (latencia avg/p95,
  hit ratio, requests a la base, consumo de memoria) para las tres variantes.
- Exp 5 (opcional): **PostgreSQL como caché** — comparar el costo de cachear en
  una tabla de PG vs. memoria del proceso, para entender los trade-offs de cada
  lugar de almacenamiento.

## Temas a explorar

- Cache-aside (lazy loading) vs. write-through vs. write-back
- TTL y la ventana de datos viejos (staleness) vs. consistencia
- Invalidación por escritura: invalidar vs. actualizar la caché
- Hit ratio, miss penalty y cold/warm cache
- Caché en memoria (Map/estructura Node) vs. PostgreSQL vs. caché externo
- Trade-offs: velocidad, consistencia, complejidad y memoria

## Estructura esperada

```
lab-05-caching/
├── package.json          # scripts: test, typecheck, exp:*
├── tsconfig.json         # TS strict, ESM (nodenext), erasableSyntaxOnly
├── src/
│   ├── db.ts             # conexión local, reset, seed
│   ├── cache.ts          # cache-aside + TTL (Map en memoria)
│   ├── api.ts            # endpoint de lectura + escritura mínimo
│   ├── exp-01-baseline.ts     # lectura directa a la base
│   ├── exp-02-cache-ttl.ts    # cache-aside con TTL
│   ├── exp-03-invalidate.ts   # invalidación por escritura
│   └── exp-04-measure.ts      # tabla de medición comparativa
├── tests/
│   └── cache.test.ts     # invariantes: TTL, invalidación, hit ratio
└── docs/
    ├── output-01-baseline.txt
    ├── output-02-cache-ttl.txt
    ├── output-03-invalidate.txt
    ├── output-04-measure.txt
    └── output-test.txt
```

## Cómo ejecutar este lab (una vez desarrollado)

Este lab usa PostgreSQL para el dato fuente pero el caché vive en memoria del
proceso; sigue el patrón de scripts y tests del LAB-01:

```bash
createdb lab_caching
npm run db:setup           # aplicar migrations + seed
npm install                # solo pg + types (TypeScript nativo, sin build)

npm run exp:baseline       # Exp 1
npm run exp:cache-ttl      # Exp 2
npm run exp:invalidate     # Exp 3
npm run exp:measure        # Exp 4

npm test                   # invariantes con node:test
npm run typecheck          # tsc --noEmit (TS strict)
```

Capturar cada salida en `docs/output-*.txt` como evidencia real.

## Cómo se conecta con el plan

LAB-05 alimenta el módulo de **Inventory & Stock Management** (reportes de
stock y agregaciones que se leen mucho y cambian poco → candidatos ideales de
caché) y es a la vez **transversal**: toda API profesional necesita saber cuándo
cachear, qué invalidar y cuánto dato viejo es aceptable. Complementa a LAB-03
(índices optimizan la consulta; la caché evita ejecutarla) y aporta el criterio
de consistencia que cualquier producto con lecturas calientes necesita.

## Criterio de completado

- [ ] Documentar problema, hipótesis y plan en este README (sección mediciones completada)
- [ ] Tres variantes medidas: base directa, cache-aside TTL, invalidación por escritura
- [ ] Evidencia real en `docs/output-*.txt` (latencia avg/p95, hit ratio, requests a la base)
- [ ] Invariante verificado con tests: TTL respetado, invalidación efectiva, hit ratio medible
- [ ] Conclusión documentada: trade-offs de staleness vs. velocidad y dónde cachear
- [ ] `npm run typecheck` limpio
