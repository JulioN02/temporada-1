import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSelect, buildInsert, buildUpdate, buildDelete } from '../src/query-builder.ts';
import type { ModelDescriptor } from '../src/schema.ts';

const userDescriptor = {
  table: 'users',
  primaryKey: 'id',
  columns: { id: 'int', name: 'string', active: 'bool', age: 'int', height: 'float', createdAt: 'date' },
} as const satisfies ModelDescriptor;

// Query builder (AD-3): pure functions returning { sql, bindings }.
// R2-S2: SQL text must contain ONLY descriptor identifiers; user values only in bindings.

test('R2-S2: buildSelect keeps user values out of SQL text', () => {
  const evil = "Robert'); DROP TABLE users;--";
  const { sql, bindings } = buildSelect(userDescriptor, { where: { name: evil } });
  assert.equal(sql, 'SELECT * FROM users WHERE name = ?');
  assert.ok(!sql.includes(evil), 'SQL text must not contain the user value');
  assert.deepEqual(bindings, [evil]);
});

test('R2-S2: buildInsert keeps user values out of SQL text', () => {
  const evil = "Robert'); DROP TABLE users;--";
  const { sql, bindings } = buildInsert(userDescriptor, { name: evil, active: true });
  assert.equal(sql, 'INSERT INTO users (name, active) VALUES (?, ?)');
  assert.ok(!sql.includes(evil), 'SQL text must not contain the user value');
  assert.deepEqual(bindings, [evil, 1]);
});

test('R2-S2: buildUpdate keeps user values out of SQL text', () => {
  const evil = "Robert'); DROP TABLE users;--";
  const { sql, bindings } = buildUpdate(userDescriptor, 7, { name: evil });
  assert.equal(sql, 'UPDATE users SET name = ? WHERE id = ?');
  assert.ok(!sql.includes(evil), 'SQL text must not contain the user value');
  assert.deepEqual(bindings, [evil, 7]);
});

test('R2-S2: buildDelete keeps user values out of SQL text', () => {
  const id = 7;
  const { sql, bindings } = buildDelete(userDescriptor, id);
  assert.equal(sql, 'DELETE FROM users WHERE id = ?');
  assert.ok(!sql.includes(String(id)), 'SQL text must not contain the id value');
  assert.deepEqual(bindings, [id]);
});

test('buildSelect: no criteria produces base SELECT with no bindings', () => {
  const { sql, bindings } = buildSelect(userDescriptor);
  assert.equal(sql, 'SELECT * FROM users');
  assert.deepEqual(bindings, []);
});

test('buildSelect: empty where produces base SELECT (no filter)', () => {
  const { sql, bindings } = buildSelect(userDescriptor, { where: {} });
  assert.equal(sql, 'SELECT * FROM users');
  assert.deepEqual(bindings, []);
});

test('buildSelect: where equality AND with coerced bindings in key order', () => {
  const { sql, bindings } = buildSelect(userDescriptor, { where: { active: true, name: 'Ana' } });
  assert.equal(sql, 'SELECT * FROM users WHERE active = ? AND name = ?');
  assert.deepEqual(bindings, [1, 'Ana']);
});

test('buildSelect: orderBy produces ORDER BY col ASC with no binding', () => {
  const { sql, bindings } = buildSelect(userDescriptor, { orderBy: 'name' });
  assert.equal(sql, 'SELECT * FROM users ORDER BY name ASC');
  assert.deepEqual(bindings, []);
});

test('buildSelect: limit binds the number', () => {
  const { sql, bindings } = buildSelect(userDescriptor, { limit: 2 });
  assert.equal(sql, 'SELECT * FROM users LIMIT ?');
  assert.deepEqual(bindings, [2]);
});

test('buildSelect: where + orderBy + limit combine in fixed order', () => {
  const { sql, bindings } = buildSelect(userDescriptor, {
    where: { active: true, age: 21 },
    orderBy: 'name',
    limit: 2,
  });
  assert.equal(sql, 'SELECT * FROM users WHERE active = ? AND age = ? ORDER BY name ASC LIMIT ?');
  assert.deepEqual(bindings, [1, 21, 2]);
});

test('R3-S4: buildSelect rejects an unknown column in where', () => {
  assert.throws(
    () => buildSelect(userDescriptor, { where: { nope: 1 } }),
    /unknown column "nope"/,
  );
});

test('R3-S4: buildSelect rejects an unknown column in orderBy', () => {
  assert.throws(
    () => buildSelect(userDescriptor, { orderBy: 'nope' }),
    /unknown column "nope"/,
  );
});

test('buildInsert: known columns only, values in data order', () => {
  const { sql, bindings } = buildInsert(userDescriptor, { name: 'Ana', active: true, age: 30 });
  assert.equal(sql, 'INSERT INTO users (name, active, age) VALUES (?, ?, ?)');
  assert.deepEqual(bindings, ['Ana', 1, 30]);
});

test('buildInsert: includes the primary key when provided (DB decides)', () => {
  const { sql, bindings } = buildInsert(userDescriptor, { id: 5, name: 'Ana' });
  assert.equal(sql, 'INSERT INTO users (id, name) VALUES (?, ?)');
  assert.deepEqual(bindings, [5, 'Ana']);
});

test('buildInsert: rejects an unknown column', () => {
  assert.throws(
    () => buildInsert(userDescriptor, { nope: 1 }),
    /unknown column "nope"/,
  );
});

test('buildInsert: rejects empty data', () => {
  assert.throws(() => buildInsert(userDescriptor, {}), /insert data must not be empty/);
});

test('buildUpdate: SET patch columns with id bound last', () => {
  const { sql, bindings } = buildUpdate(userDescriptor, 3, { age: 21, name: 'A' });
  assert.equal(sql, 'UPDATE users SET age = ?, name = ? WHERE id = ?');
  assert.deepEqual(bindings, [21, 'A', 3]);
});

test('buildUpdate: rejects an unknown patch column', () => {
  assert.throws(
    () => buildUpdate(userDescriptor, 3, { nope: 1 }),
    /unknown column "nope"/,
  );
});

test('buildUpdate: rejects an empty patch (model layer treats it as no-op)', () => {
  assert.throws(() => buildUpdate(userDescriptor, 3, {}), /update patch must not be empty/);
});

test('buildDelete: binds id with pk taken from the descriptor', () => {
  const { sql, bindings } = buildDelete(userDescriptor, 7);
  assert.equal(sql, 'DELETE FROM users WHERE id = ?');
  assert.deepEqual(bindings, [7]);
});