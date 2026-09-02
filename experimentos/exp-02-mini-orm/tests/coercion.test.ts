import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toSql, fromSql } from '../src/coercion.ts';

// Bidirectional coercion (AD-2, R10): JS value <-> SQL storage value per column type.
// Unit-level rendering of R10-S1..S4 (full create/findById integration lands in groups 5-6).

test('R10-S1: bool round-trip stores 0/1', () => {
  assert.equal(toSql(true, 'bool'), 1);
  assert.equal(toSql(false, 'bool'), 0);
  assert.equal(fromSql(1, 'bool'), true);
  assert.equal(fromSql(0, 'bool'), false);
});

test('gotcha: toSql(true) is the integer 1, not a JS boolean (node:sqlite rejects booleans)', () => {
  const bound = toSql(true, 'bool');
  assert.equal(bound, 1);
  assert.notEqual(bound, true);
  assert.equal(typeof bound, 'number');
});

test('R10-S2: date round-trip preserves the instant (ISO-8601 UTC TEXT)', () => {
  const original = new Date('2026-08-30T10:00:00.000Z');
  const stored = toSql(original, 'date');
  assert.equal(stored, '2026-08-30T10:00:00.000Z');
  const hydrated = fromSql(stored, 'date');
  assert.ok(hydrated instanceof Date);
  assert.equal((hydrated as Date).getTime(), original.getTime());
});

test('R10-S3: null and undefined coerce to SQL NULL for any type', () => {
  assert.equal(toSql(null, 'string'), null);
  assert.equal(toSql(undefined, 'string'), null);
  assert.equal(toSql(null, 'date'), null);
  assert.equal(fromSql(null, 'string'), null);
  assert.equal(fromSql(null, 'bool'), null);
});

test('R10-S4: int and float round-trip preserving numeric type', () => {
  assert.equal(toSql(42, 'int'), 42);
  assert.equal(fromSql(42, 'int'), 42);
  assert.equal(toSql(3.5, 'float'), 3.5);
  assert.equal(fromSql(3.5, 'float'), 3.5);
});

test('R10-S4: string round-trips verbatim (base R1-S2, never guessed)', () => {
  assert.equal(toSql('42', 'string'), '42');
  assert.equal(fromSql('42', 'string'), '42');
  assert.equal(fromSql('hi', 'string'), 'hi');
});

test('toSql: rejects a string for int with a descriptive error', () => {
  assert.throws(() => toSql('42', 'int'), /column of type "int" cannot store value/);
});

test('toSql: rejects invalid input for string, bool and date', () => {
  assert.throws(() => toSql(42, 'string'), /type "string" cannot store value/);
  assert.throws(() => toSql('yes', 'bool'), /type "bool" cannot store value/);
  assert.throws(() => toSql('not-a-date', 'date'), /type "date" cannot store value/);
});

test('fromSql: bool only accepts 0/1 (rejects truthiness that hides corruption)', () => {
  assert.throws(() => fromSql(2, 'bool'), /type "bool"/);
  assert.throws(() => fromSql(true, 'bool'), /type "bool"/);
  assert.throws(() => fromSql('1', 'bool'), /type "bool"/);
});

test('fromSql: int/float reject non-numeric storage (never Number(value))', () => {
  assert.throws(() => fromSql('42', 'int'), /type "int"/);
  assert.throws(() => fromSql('3.5', 'float'), /type "float"/);
});

test('fromSql: string rejects non-string storage', () => {
  assert.throws(() => fromSql(42, 'string'), /type "string"/);
});

test('fromSql: date rejects an invalid ISO string', () => {
  assert.throws(() => fromSql('not-a-date', 'date'), /type "date"/);
});

test('fromSql: int accepts bigint when it appears, converting to number with a guard', () => {
  assert.equal(fromSql(42n, 'int'), 42);
});