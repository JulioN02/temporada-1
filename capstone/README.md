# CAPSTONE — Business Operations Platform

**El proyecto insignia de la Temporada 1.** Documentación en Obsidian → `Capstone/CAPSTONE - Business Operations Platform.md`.

> Al terminar, debe ser **lo mejor que hice durante la Temporada 1**. No tiene que ser gigantesco: tiene que ser **serio, integrado y bien explicado**.

Estado: 🔲 Pendiente (idea — scaffolding)

## Qué es

Una plataforma pequeña pero seria para gestionar operaciones de una empresa.

```
          ┌───────────────┐
          │  Users/Roles  │
          └───────┬───────┘
                  │
   ┌──────────────┼──────────────┐
   ↓              ↓              ↓
Inventory      Orders        Customers
   │              │              │
   └──────────────┼──────────────┘
                  ↓
             Workflows
                  ↓
          Notifications
                  ↓
                Audit
```

## Stack y capacidades

| Capa | Capacidades |
|---|---|
| **Base** | Autenticación, RBAC, PostgreSQL, API REST, validación, transacciones, auditoría |
| **Operación** | Jobs, emails, generación de documentos (PDF) |
| **Calidad** | Tests, OpenAPI, Docker, logging |
| **Producción** | Deployment |

## Reglas del capstone

1. **No se implementa todo de golpe** — se evoluciona durante la temporada. Parte desde el **Inventory & Stock Management** y crece.
2. **Integra los experimentos aprendidos**: la message queue, el mini-framework, el mini-ORM, el lenguaje de consultas o el storage engine pueden aparecer dentro del proyecto insignia.
3. **Se documenta como insignia**: GitHub, demo, documentación, arquitectura, ADRs, tests, deployment, video, artículos, changelog, roadmap y caso de estudio de portafolio.

## Cómo se presenta

> "Construí una plataforma de operaciones donde workflows automatizados orquestan inventario, pedidos y notificaciones" — no "proyecto de Node + PostgreSQL".

## Enlaces

- Índice de la temporada → [`../README.md`](../README.md)
- Proyecto base → [Inventory & Stock Management (GitHub)](https://github.com/JulioN02/inventory-stock)