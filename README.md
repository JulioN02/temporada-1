# Temporada 1 — Fundamentos de Ingeniería de Software

Mapa en código de la **Temporada 1** del plan de desarrollo profesional: software profesional de principio a fin — APIs REST, PostgreSQL, Git, testing y decisiones de ingeniería.

> **Principio rector**: *no demuestro que conozco una tecnología; demuestro que sé utilizarla para construir algo que tiene sentido.*

📦 **Repositorio del workspace:** [`JulioN02/temporada-1`](https://github.com/JulioN02/temporada-1)

## Regla del workspace

**Código aquí, documentación allá.** El código y la evidencia viven en este workspace; las explicaciones, decisiones y el estado de cada proyecto viven en el vault de Obsidian:

> `~/Documents/Obsidian/Obsidian-Vault/Desarrollo-Profesional/` — abrir **Index.md** como panel central.

## Estructura

| Carpeta | Contenido | Estado |
|---|---|---|
| `herramientas/` | Dev Toolkit `jdev` (CLI en Node/TS) | ✅ **Hecho** — publicado en npm `@jsoftsolutions/jdev@0.13.1` + GitHub |
| `laboratorios-ingenieria/` | 8 labs de ingeniería (races, idempotencia, SQL, ...) | 🟡 LAB-01..04 hechos · LAB-05..08 pendientes |
| `proyectos-profesionales/` | Proyectos CORE de portafolio (Inventory & Stock, Workflow Engine) | 🟡 Inventory & Stock entregado · Workflow Engine pendiente |
| `proyectos-rapidos/` | Ideas de 1–3 días (8 carpetas) | 🟡 01 implementado · 02–08 pendientes |
| `experimentos/` | Entender por dentro (Mini ORM, Mini Message Queue, ...) | 💡 Pendiente |
| `capstone/` | Business Operations Platform (proyecto insignia) | 💡 Pendiente |
| `evidencia/` *(planificada)* | Screenshots, demos, changelogs publicables | ⚪ Por crear |
| `contenido/` *(planificada)* | Artículos "cómo lo hice" | ⚪ Por crear |
| `fundamentos/` *(planificada)* | Seguimiento de conocimientos | ⚪ Por crear |
| `servicios/` *(planificada)* | Material de servicios freelance | ⚪ Por crear |
| `prerrequisitos/` *(planificada)* | Ejercicios de prerrequisitos confirmados | ⚪ Por crear |

## Estado actual

| Ítem | Estado | Detalle |
|---|---|---|
| Dev Toolkit `jdev` | ✅ Hecho | CLI 9/9 comandos + TUI + i18n es/en · publicado `@jsoftsolutions/jdev@0.13.1` (npm) · [GitHub](https://github.com/JulioN02/JDEV-TOOL) |
| LAB-01 Race Condition | ✅ Hecho | 5 mecanismos contra el oversell, tests 2/2 · [GitHub](https://github.com/JulioN02/lab-01-race-condition) |
| LAB-02 Idempotency | ✅ Hecho | 5 estrategias, tests 4/4 · [GitHub](https://github.com/JulioN02/lab-02-idempotency) |
| LAB-03 Query Performance | ✅ Hecho | 4 experimentos, tests 4/4 · [GitHub](https://github.com/JulioN02/lab-03-query-performance) |
| LAB-04 Rate Limiting | ✅ Hecho | 5 experimentos, tests 21/21 · [GitHub](https://github.com/JulioN02/lab-04-rate-limiting) |
| LAB-05..08 | 🔲 Pendiente | Caching · Background Jobs · Retry/Failure · Audit Trail |
| Inventory & Stock Management | ✅ Hecho/Entregado | 138/138 tests · backend + frontend + RBAC + auditoría · [GitHub](https://github.com/JulioN02/inventory-stock) |
| Workflow Automation Engine | 🔲 Pendiente | EVENT → RULE → ACTION (colas, workers, retries) |
| Developer/Operations Platform | 🔲 Pendiente (opcional) | Mini plataforma de registro y salud de aplicaciones |
| Proyectos rápidos | 🟡 Parcial | 01 File Organizer implementado (CLI, 50 tests) · 02–08 ideas pendientes |
| Experimentos | 🔲 Pendiente | 5 experimentos para entender por dentro |
| CAPSTONE | 🔲 Pendiente | Business Operations Platform |

## Enlaces

- Plan general de las 8 temporadas → [`docs/plan-desarrollo-profesional.md`](docs/plan-desarrollo-profesional.md)
- Repositorio del workspace → [`JulioN02/temporada-1`](https://github.com/JulioN02/temporada-1)
- Documentación y estado detallado → **Obsidian vault** → `Index.md`
- Check de avance de la temporada → `Checklist Temporada 1` (vault)

### Repositorios de los sub-proyectos completados

| Proyecto | Repositorio |
|---|---|
| Dev Toolkit `jdev` | [JulioN02/JDEV-TOOL](https://github.com/JulioN02/JDEV-TOOL) · npm [`@jsoftsolutions/jdev`](https://www.npmjs.com/package/@jsoftsolutions/jdev) |
| LAB-01 Race Condition | [JulioN02/lab-01-race-condition](https://github.com/JulioN02/lab-01-race-condition) |
| LAB-02 Idempotency | [JulioN02/lab-02-idempotency](https://github.com/JulioN02/lab-02-idempotency) |
| LAB-03 Query Performance | [JulioN02/lab-03-query-performance](https://github.com/JulioN02/lab-03-query-performance) |
| LAB-04 Rate Limiting | [JulioN02/lab-04-rate-limiting](https://github.com/JulioN02/lab-04-rate-limiting) |
| Inventory & Stock Management | [JulioN02/inventory-stock](https://github.com/JulioN02/inventory-stock) |