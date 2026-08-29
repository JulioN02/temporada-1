# Workflow Automation Engine

Proyecto profesional CORE de la Temporada 1. Documentación pedagógica en Obsidian → `Proyectos profesionales/Workflow Automation Engine.md`.

> Un **motor de automatización pequeño**: EVENT → RULE → ACTION.

Estado: 🔲 Pendiente (idea — scaffolding)

## Qué demuestra

No es "otro CRUD": es un motor donde las reglas de negocio se ejecutan de forma automatizada. El valor está en el **orquestación de eventos hacia acciones**, con garantías de ejecución.

## Ejemplos

**Ejemplo 1** — captura y procesamiento de formularios:

```
formulario nuevo → guardar cliente → generar PDF → enviar email → registrar evento
```

**Ejemplo 2** — regla condicional sobre pedidos:

```
pedido creado → si total > $500.000 → notificar administrador
```

## Capacidades que demuestra

| Capacidad | Qué implica |
|---|---|
| **Eventos** | Modelo EVENT → RULE → ACTION |
| **Workers** | Ejecución de tareas en background |
| **Jobs** | Encadenamiento y seguimiento de tareas |
| **Retries** | Reintentos ante fallos transitorios |
| **Idempotencia** | Ejecutar dos veces ≠ duplicar efectos |
| **Webhooks** | Disparar acciones hacia sistemas externos |
| **Scheduling (cron)** | Acciones programadas |
| **Integraciones** | PDF, email, almacenamiento |

## Labs que lo alimentan

- LAB-06 Background Jobs — colas y workers
- LAB-07 Retry / Failure — reintentos y manejo de fallos