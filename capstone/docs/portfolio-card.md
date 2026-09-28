# Business Operations Platform (BOP v1)

*Plataforma para la gestión y control de operaciones empresariales*

**Enlaces:** repositorio: https://github.com/JulioN02/business-operations-platform · dashboard: https://julion02.github.io/business-operations-platform/ · evidencia: https://julion02.github.io/business-operations-platform/evidence/

## Qué es

BOP es una plataforma que centraliza clientes, catálogo, bodegas, inventario, pedidos,
notificaciones y auditoría en un solo sistema operado. Es el capstone de la Temporada 1
y se construyó con foco en requisitos verificables, integridad de datos, trazabilidad y
operación real del sistema.

## Qué problema aborda

Las operaciones de una empresa suelen estar fragmentadas en planillas, correos y
herramientas inconexas. Esa fragmentación produce errores caros: vender stock que no
existe, perder avisos críticos, pedidos sin estado claro y cero trazabilidad sobre quién
hizo qué. BOP integra esos flujos con control de acceso por roles, reglas de negocio
explícitas, trazabilidad completa y consistencia transaccional. No es un CRUD: es un
sistema que mantiene la integridad de los datos frente a la concurrencia, los errores y
los reintentos.

## Qué incluye

**Gestión operativa:** clientes, productos, bodegas, inventario y movimientos, pedidos y dashboard.

**Control y gobernanza:** autenticación y autorización por roles, auditoría de solo escritura (append-only), usuarios y permisos, jobs y reintentos.

**Comunicación:** notificaciones in-app, correo, plantillas bilingües (es/en neutro) y worker durable.

Nota: 5 roles — admin, manager, operator, viewer, auditor.

## Enfoque de ingeniería

- Integridad transaccional: confirmación de pedido atómica en una única transacción.
- Dinero sin float: representación decimal exacta (D13) en backend y frontend.
- Jobs durables en la misma transacción (pg-boss): exactly-once sin outbox ni poller.
- Ledger de stock inmutable con niveles derivados y eventos sin polling.
- Verificación con evidencia: strict TDD, tests referenciados por requisito.
- Operación real: appliance Docker autocontenido, CI/CD y runbook de despliegue.

## Verificación

| Métrica | Resultado |
|---|---|
| Tests backend | 256/256 |
| Tests frontend | 217/217 |
| Requisitos cubiertos | 72/72 |
| TypeScript | 0 errores |
| Chunk inicial | 132.53 kB gzip |

Probado contra PostgreSQL real y un appliance Docker en ejecución.

## Stack

Node 22 · TypeScript · Express 5 + Zod · PostgreSQL 16 · React 19 + Vite · pg-boss · Docker + GHCR

## Qué demuestra

Portafolio orientado a problemas: cada proyecto demuestra cómo se usa la tecnología para
resolver un problema real, con el núcleo transferible ANALIZAR → DISEÑAR → DIAGNOSTICAR →
IMPLEMENTAR → VERIFICAR → OPERAR → MEJORAR. Perfiles: Software/Backend y Systems
Analyst/IT Analyst. El nombre del cargo varía entre empresas; la evidencia es la constante.

## Enlaces

- Repositorio: https://github.com/JulioN02/business-operations-platform
- Dashboard: https://julion02.github.io/business-operations-platform/
- Evidencia: https://julion02.github.io/business-operations-platform/evidence/