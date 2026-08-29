# LAB-07 — Reintentos y Fallos (Retry / Failure)

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Este README es la introducción del laboratorio: definición, hipótesis y plan de experimentos.
> **Estado**: 🔲 Pendiente — lo desarrollo yo (revisar, ejecutar, medir, documentar).

## Problema

Una API externa (pasarela de pago, proveedor de mensajería, servicio de
archivos) falla: timeout, conexión caída, `5xx` temporal. Si nuestra aplicación
no reintenta, pierde la operación; si reintenta de forma ingenua (inmediato,
siempre igual), puede sobrecargar al proveedor recién recuperado y seguir
fallando una y otra vez. ¿Cuándo reintentar? ¿Cuántas veces? ¿Cómo de rápido?

El reintento ingenuo falla por dos lados: **reintentar demasiado rápido** no le
da tiempo al servicio externo a recuperarse (y multiplica la carga justo cuando
está débil), y **reintentar sin espera controlada** convierte un error transitorio
en una cascada. Además, reintentar una operación que *sí* llegó a ejecutarse
pero cuyo resultado se perdió en la red causa **efectos duplicados** (vínculo
directo con LAB-02): el reintento solo es seguro si la operación es idempotente.

La respuesta clásica es la **política de reintentos**: espera exponencial
(cada intento espera el doble que el anterior), **jitter** (aleatoriedad para
evitar que todos los clientes reintenten al unísono), un **límite de intentos**,
y un destino final para lo que nunca pudo completarse (dead-letter). Las
técnicas de circuit breaker (abrir el circuito, dejar de intentar, esperar)
son la evolución natural cuando el proveedor está caído de verdad, no solo
lento. El lab simula un proveedor externo que falla según un patrón controlado
y mide cómo las distintas políticas lo navegan.

## Objetivo del lab

Implementar y medir políticas de reintento (reintento inmediato vs.
exponential backoff con jitter), entender el límite de intentos y el concepto
de dead-letter (¿dónde termina lo que nunca sale?), y ver en práctica cómo la
idempotencia (LAB-02) hace seguro reintentar. Terminar con la intuición de
circuit breaking como evolución natural.

## Hipótesis

Antes de correr los experimentos, las expectativas son:

1. **Reintento inmediato (naive)**: ante un proveedor que falla un rato y luego
   responde, el reintento inmediato gasta todos los intentos en la ventana de
   fallo, golpea al proveedor en su momento más débil y **termina fallando**
   aunque el servicio se recuperaba.
2. **Exponential backoff con jitter**: la espera creciente (ej. 100ms → 200ms →
   400ms → …) alinea los reintentos con la recuperación del proveedor; el jitter
   **reduce la sincronización** entre clientes. Hipótesis: logra el éxito con
   menos intentos y menos carga sobre el proveedor.
3. **El límite de intentos existe por algo**: sin límite, un proveedor caído se
   convierte en un hilo bloqueado para siempre y en carga infinita; con
   **máximo N intentos**, lo que fracasa va a un destino final (dead-letter) y
   la operación se declara fallida — mejor que reintentar para siempre.
4. **La semántica del reintento requiere idempotencia**: si el primer intento
   realmente se ejecutó (pero no lo supimos), el reintento **duplica**; solo con
   clave de idempotencia (LAB-02) el reintento es seguro. Hipótesis: sin
   idempotencia aparecen efectos duplicados; con ella, no.
5. **Las mediciones lo muestran**: tabla de intentos por política (intentos
   totales, tiempos de espera acumulados, éxito/fracaso final, carga enviada al
   proveedor) — el backoff no solo funciona, se *ve* que funciona y a qué costo.

## Plan de experimentos

- Exp 1: **Reintento inmediato (naive)** — simular un proveedor que falla
  (patrón controlado: error N segundos y luego éxito) y reintentar sin espera;
  medir intentos, carga sobre el proveedor y éxito final.
- Exp 2: **Exponential backoff con jitter** — misma simulación, espera creciente
  + aleatoriedad; medir intentos usados, tiempo total y carga entregada.
- Exp 3: **Límite + dead-letter** — proveedor caído de verdad; con máximo de
  intentos, hacer que el job pase a un destino de fallo (dead-letter) y luego
  (simulado) re-procesarlo o descartarlo.
- Exp 4: **Reintentos idempotentes** — el "éxito fantasma" (la operación se
  ejecutó pero el resultado se perdió); demostrar duplicación sin idempotencia
  y su ausencia con clave de idempotencia (puente a LAB-02).
- Exp 5 (opcional): **Circuit breaker** — patrón de fallos sostenidos: abrir el
  circuito (no intentar más durante una ventana), half-open, y medición de la
  descarga de trabajo durante la ventana.

## Temas a explorar

- Políticas de retry: espera fija vs. exponencial vs. exponencial + jitter
- Límite de intentos y semántica de fallo (fail-fast vs. reencolar)
- Dead-letter: dónde terminan las operaciones que nunca salieron
- Jitter: por qué la aleatoriedad evita el "thundering herd"
- Idempotencia aplicada a reintentos (vínculo LAB-02)
- Circuit breaker: closed → open → half-open y su intuición práctica
- Clasificar errores: cuáles son reintentables (5xx, timeout) y cuáles no (4xx)

## Estructura esperada

```
lab-07-retry-failure/
├── package.json          # scripts: test, typecheck, exp:*
├── tsconfig.json         # TS strict, ESM (nodenext), erasableSyntaxOnly
├── src/
│   ├── provider.ts       # proveedor externo SIMULADO con patrón de fallos
│   ├── retry.ts          # políticas: naive, backoff, jitter, límite, dead-letter
│   ├── circuit.ts        # (opcional) circuit breaker
│   ├── exp-01-naive.ts       # reintento inmediato
│   ├── exp-02-backoff.ts     # exponential backoff + jitter
│   ├── exp-03-deadletter.ts  # límite + dead-letter
│   └── exp-04-idempotent.ts  # reintentos idempotentes
├── tests/
│   └── retry.test.ts     # invariantes: límite, espera creciente, dead-letter
└── docs/
    ├── output-01-naive.txt
    ├── output-02-backoff.txt
    ├── output-03-deadletter.txt
    ├── output-04-idempotent.txt
    └── output-test.txt
```

## Cómo ejecutar este lab (una vez desarrollado)

Este lab es autocontenido (simula el proveedor externo, no requiere base de
datos), pero sigue el patrón de scripts y tests del LAB-01:

```bash
npm install                # solo TypeScript nativo (sin build), node:test

npm run exp:naive          # Exp 1
npm run exp:backoff        # Exp 2
npm run exp:deadletter     # Exp 3
npm run exp:idempotent     # Exp 4

npm test                   # invariantes con node:test
npm run typecheck          # tsc --noEmit (TS strict)
```

Capturar cada salida en `docs/output-*.txt` como evidencia real.

## Cómo se conecta con el plan

LAB-07 alimenta la **robustez** del módulo de **Workflow Automation Engine**:
cada ACTION que llama a servicios externos (integraciones, notificaciones,
proveedores) necesita reintentos con política, límite y dead-letter para que un
pico de fallos no derribe el motor completo — y el reintento solo es seguro si
la ACTION es idempotente (LAB-06 + LAB-02). Es además pieza clave del
**CAPSTONE**: un sistema real de integraciones pasa más tiempo recuperándose de
fallos que operando a pleno, y este criterio define cuán confiable es el
producto.

## Criterio de completado

- [ ] Documentar problema, hipótesis y plan en este README (sección mediciones completadas)
- [ ] Políticas implementadas: naive, exponential backoff + jitter, límite + dead-letter
- [ ] Mediciones con evidencia real en `docs/output-*.txt` (intentos, tiempos, carga al proveedor, éxito/fracaso)
- [ ] Invariante verificado con tests: límite respetado, espera creciente, dead-letter funcionando
- [ ] Conclusión documentada: cuándo reintentar, cuánto esperar y por qué la idempotencia hace seguro el reintento
- [ ] `npm run typecheck` limpio