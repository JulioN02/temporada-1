# EXP-01 · Mini lenguaje de consultas

Experimento de la Temporada 1. Documentación en Obsidian → `Experimentos/Experimentos.md`.

Estado: 🔲 Pendiente (idea)

## Qué construyes

Un mini lenguaje de consultas: algo como `users where age > 20` convertido a SQL (`SELECT * FROM users WHERE age > 20`).

## Qué entiendes

- **Parsing**: leer una cadena y convertirla en una estructura procesable
- **Tokens**: dividir la entrada en unidades mínimas con significado
- **AST**: árbol de sintaxis que representa la consulta
- **Interpretación**: recorrer el AST y generar la salida (SQL)

## Por qué

Es la base de los **query builders** y los ORMs. Si entiendes cómo se construye y se interpreta una consulta, dejas de ver estas herramientas como cajas negras.

## Relación con otros experimentos

- EXP-02 Mini ORM: el ORM genera consultas — este experimento muestra el mecanismo
- CAPSTONE: puede aparecer como capa de acceso a datos