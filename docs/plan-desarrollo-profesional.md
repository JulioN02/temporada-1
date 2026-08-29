# Plan de Desarrollo Profesional

Este workspace es el espacio de trabajo de un plan de desarrollo profesional a largo plazo: **8 temporadas** que van desde la Ingeniería de Software hasta la Ingeniería de Sistemas (Systems Engineering). Aquí se acumula la evidencia de cada temporada —proyectos, laboratorios, herramientas, contenido y certificaciones— para construir un portafolio diferenciado con impacto social y empleabilidad progresiva.

## Identidad profesional objetivo

> **Systems-oriented Software Engineer** — *Software Developer | Backend & Systems*

Un ingeniero que entiende el **sistema completo**: software + datos + servidores + redes + infraestructura + operación + eventualmente hardware.

## Las 8 temporadas

| # | Temporada | Aprendizaje principal | Puertas laborales que abre |
|---|-----------|----------------------|----------------------------|
| 1 | Fundamentos de Ingeniería de Software | Software profesional de principio a fin: APIs REST, PostgreSQL, Git, testing | Backend/Software Jr, API Developer · freelance: APIs, sistemas administrativos |
| 2 | Product Engineering | Convertir procesos de negocio en software | Software Engineer, Full Stack, Application Developer · freelance: software empresarial, dashboards, CRM |
| 3 | Linux + Infraestructura | Construir **y operar** software | IT Support, Infrastructure Support, SysAdmin Jr · freelance: VPS, Docker, Nginx, HTTPS, deployments, backups |
| 4 | Redes (Cisco) | Redes y conectividad certificadas | NOC Analyst, Network Support, Network Technician, Data Center Technician |
| 5 | DevOps / Cloud | Crear → desplegar → automatizar → monitorear | Cloud Support, DevOps Jr, Cloud Operations (Azure, Terraform, CI/CD, observabilidad) |
| 6 | Sistemas distribuidos | Tiempo real, eventos, colas | Backend Engineer, Platform, Integration (WebSockets, eventos, colas) |
| 7 | IoT | Software + infraestructura + hardware | IoT Developer, ESP32, MQTT, Edge Computing |
| 8 | Systems Engineering | Integrar y diseñar sistemas completos | Systems/Infrastructure/Platform/Solutions Engineer |

> La clave de la ruta: **no esperar a terminar las 8 temporadas para buscar empleo**. Cada temporada es un peldaño de una escalera laboral (ver `docs/estrategia-empleabilidad.md`).

## Estructura de carpetas

```
Desarrollo-Profesional/
├── README.md                  ← Este archivo: vista general del plan
└── temporada-1/               ← SOLO CÓDIGO y evidencia de la temporada 1
    ├── prerrequisitos/        ← (código/ejercicios; la guía de flujo Git vive en Obsidian)
    ├── proyectos-rapidos/     ← Código de ideas de 1–3 días
    ├── herramientas/          ← Código del Dev Toolkit CLI `jdev`
    ├── proyectos-profesionales/ ← Código: Inventory & Stock + Workflow Automation
    ├── laboratorios-ingenieria/ ← Código/experimentos de los 8 labs
    ├── experimentos/          ← Código de experimentos (Mini ORM, Event Bus...)
    ├── capstone/              ← Código del proyecto insignia
    ├── evidencia/             ← Evidencia publicable (screenshots, demos, changelogs)
    ├── contenido/             ← Artículos publicables
    ├── fundamentos/           ← Seguimiento de conocimientos
    └── servicios/             ← Material de servicios freelance
```

> **📚 DOCUMENTACIÓN → OBSIDIAN (desde 2026-08-12):** toda la documentación, explicaciones, decisiones y estado de proyectos viven en el vault de Obsidian:
> `~/Documents/Obsidian/Obsidian-Vault/Desarrollo-Profesional/` — abrir **Index.md** como panel central.
> Regla: **código aquí, documentación allá** (ver "Cómo usar este vault" dentro del vault).

---

> **Nota de este repositorio (temporada-1):** este archivo es una copia del plan general del workspace padre (`../README.md`, fuera de este repositorio) para que el plan de las 8 temporadas sea visible desde GitHub. La referencia a `docs/estrategia-empleabilidad.md` y el vault de Obsidian viven **fuera** de este repositorio.
