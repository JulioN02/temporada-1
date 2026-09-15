/**
 * EXP-02 · Mini ORM — Live demo with a REAL node:sqlite database.
 *
 * Runs the actual library (src/model.ts + src/query-builder.ts + src/coercion.ts
 * + src/schema.ts) against a real :memory: DatabaseSync. For every operation it
 * prints the generated SQL + bindings (captured from the query builder directly)
 * and the real result. Neutral Spanish, no voseo.
 */

import { DatabaseSync } from 'node:sqlite';

import { createModel } from '../src/model.ts';
import type { ModelInstance } from '../src/model.ts';
import { buildSelect, buildInsert, buildUpdate, buildDelete } from '../src/query-builder.ts';
import type { BuildQuery } from '../src/query-builder.ts';
import type { ModelDescriptor } from '../src/schema.ts';

const descriptor: ModelDescriptor = {
  table: 'users',
  primaryKey: 'id',
  columns: {
    id: 'int',
    name: 'string',
    email: 'string',
    age: 'int',
    active: 'bool',
    created_at: 'date',
  },
};

const DDL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    age INTEGER,
    active INTEGER,
    created_at TEXT
  );
`;

const db = new DatabaseSync(':memory:');
db.exec(DDL);

const User = createModel(descriptor, db);

function section(title: string): void {
  console.log('');
  console.log('='.repeat(72));
  console.log(`  ${title}`);
  console.log('='.repeat(72));
}

function showQuery(label: string, q: BuildQuery): void {
  console.log(`  --- ${label} ---`);
  console.log(`  SQL      : ${q.sql}`);
  console.log(`  bindings : ${JSON.stringify(q.bindings)}`);
}

function instanceToPlain(instance: ModelInstance): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of Object.keys(descriptor.columns)) {
    out[col] = instance[col];
  }
  return out;
}

function showInstance(label: string, instance: ModelInstance): void {
  console.log(`  ${label}:`);
  console.log(
    JSON.stringify(instanceToPlain(instance), (_key, value) =>
      value instanceof Date ? value.toISOString() : value,
      2,
    ),
  );
}

function showInstances(label: string, instances: ModelInstance[]): void {
  console.log(`  ${label}: ${instances.length} resultado(s)`);
  for (const instance of instances) {
    console.log(
      `   - ${JSON.stringify(instanceToPlain(instance), (_key, value) =>
        value instanceof Date ? value.toISOString() : value,
      )}`,
    );
  }
}

console.log('='.repeat(72));
console.log('  EXP-02 · MINI ORM — DEMO EN VIVO');
console.log('  Motor real: node:sqlite (DatabaseSync) · base :memory:');
console.log('='.repeat(72));

section('1 · Esquema y descriptor');
console.log(`  DDL ejecutado:\n${DDL}`);
console.log(`  Descriptor: ${JSON.stringify(descriptor, null, 2)}`);

section('2 · create() — insertar dos usuarios');
{
  const data1 = { name: 'Ana', email: 'ana@example.com', age: 28, active: true, created_at: new Date('2026-09-15T10:30:00Z') };
  showQuery('INSERT usuario 1', buildInsert(descriptor, data1));
  const ana = User.create(data1);
  showInstance('  Resultado', ana);

  const data2 = { name: 'Bruno', email: 'bruno@example.com', age: 34, active: false, created_at: new Date('2026-09-14T08:00:00Z') };
  showQuery('INSERT usuario 2', buildInsert(descriptor, data2));
  const bruno = User.create(data2);
  showInstance('  Resultado', bruno);
}

section('3 · findById(1) — hidratación de tipos');
{
  const q = buildSelect(descriptor, { where: { id: 1 } });
  showQuery('SELECT por PK', q);
  const ana = User.findById(1);
  if (ana === null) throw new Error('findById(1) devolvió null');
  showInstance('  Resultado', ana);
  console.log(`  Tipos comprobados: active es ${typeof ana.active} · created_at es ${ana.created_at instanceof Date ? 'Date' : typeof ana.created_at}`);
}

section('4 · find({ where: { active: true } }) — consulta filtrada');
{
  const q = buildSelect(descriptor, { where: { active: true } });
  showQuery('SELECT filtrado', q);
  const activeUsers = User.find({ where: { active: true } });
  showInstances('  Resultado', activeUsers);
}

section('5 · update(1, { age: 32 }) — actualización estática');
{
  const q = buildUpdate(descriptor, 1, { age: 32 });
  showQuery('UPDATE', q);
  const updated = User.update(1, { age: 32 });
  showInstance('  Resultado', updated === null ? 'null' : updated);
}

section('6 · save() de instancia — mutar y persistir');
{
  const ana = User.findById(1);
  if (ana === null) throw new Error('findById(1) devolvió null en save()');
  ana.name = 'Ana María';
  const patch: Record<string, unknown> = {};
  for (const column of Object.keys(descriptor.columns)) {
    if (column !== descriptor.primaryKey) patch[column] = ana[column];
  }
  showQuery('UPDATE desde save()', buildUpdate(descriptor, 1, patch));
  const saved = ana.save();
  console.log(`  save() devolvió: ${saved}`);
  const persisted = User.findById(1);
  showInstance('  Persistido', persisted === null ? 'null' : persisted);
}

section('7 · delete(2) — borrar y comprobar ausencia');
{
  const q = buildDelete(descriptor, 2);
  showQuery('DELETE', q);
  const deleted = User.delete(2);
  console.log(`  delete(2) devolvió: ${deleted}`);
  const gone = User.findById(2);
  console.log(`  findById(2) después del borrado: ${gone === null ? 'null (correcto)' : '¡TODAVÍA EXISTE!'}`);
}

section('8 · Inyección SQL — el payload se guarda como dato, no como SQL');
{
  const payload = "Robert'); DROP TABLE users;--";
  const data = { name: payload, email: 'robert@example.com', age: 99, active: true, created_at: new Date('2026-01-01T00:00:00Z') };
  showQuery('INSERT con payload malicioso', buildInsert(descriptor, data));
  const created = User.create(data);
  console.log(`  Fila creada con id=${String(created.id)}`);

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  console.log(`  ¿Existe aún la tabla users? ${table !== undefined ? `SÍ: ${table.name}` : '¡NO! (la tabla fue destruida)'}`);

  const found = User.find({ where: { name: payload } });
  showInstances('  El payload se recupera tal cual', found);
}

section('9 · Resumen');
{
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  const count = typeof row.n === 'bigint' ? Number(row.n) : row.n;
  console.log(`  Filas en la tabla users: ${String(count)}`);
  console.log(`  Total de tablas: ${db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n}`);
}

console.log('');
console.log('='.repeat(72));
console.log('  DEMO FINALIZADA SIN ERRORES');
console.log('='.repeat(72));

db.close();