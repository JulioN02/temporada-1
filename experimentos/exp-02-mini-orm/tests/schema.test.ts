import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateDescriptor, assertKnownColumn } from '../src/schema.ts';
import type { ModelDescriptor } from '../src/schema.ts';

const validDescriptor: ModelDescriptor = {
  table: 'users',
  primaryKey: 'id',
  columns: { id: 'int', name: 'string', active: 'bool' },
};

// Support tests for the schema descriptor (AD-1) — base for R1 and R3-S4.

test('R1: validateDescriptor accepts a valid descriptor', () => {
  assert.doesNotThrow(() => validateDescriptor(validDescriptor));
});

test('R1: validateDescriptor rejects an empty table', () => {
  assert.throws(() => validateDescriptor({ ...validDescriptor, table: '' }), /table/);
});

test('R1: validateDescriptor rejects a missing table', () => {
  const missing = { ...validDescriptor, table: undefined } as unknown as ModelDescriptor;
  assert.throws(() => validateDescriptor(missing), /table/);
});

test('R1: validateDescriptor rejects an empty primaryKey', () => {
  assert.throws(() => validateDescriptor({ ...validDescriptor, primaryKey: '' }), /primaryKey/);
});

test('R1: validateDescriptor rejects a missing primaryKey', () => {
  const missing = { ...validDescriptor, primaryKey: undefined } as unknown as ModelDescriptor;
  assert.throws(() => validateDescriptor(missing), /primaryKey/);
});

test('R1: validateDescriptor rejects a primaryKey not declared in columns', () => {
  assert.throws(
    () => validateDescriptor({ ...validDescriptor, primaryKey: 'nope' }),
    /not a declared column/,
  );
});

test('R1: validateDescriptor rejects empty columns', () => {
  assert.throws(
    () => validateDescriptor({ table: 'users', primaryKey: 'id', columns: {} }),
    /columns/,
  );
});

test('R1: validateDescriptor rejects an invalid column type', () => {
  const invalid = {
    table: 'users',
    primaryKey: 'id',
    columns: { id: 'int', nope: 'bogus' },
  } as unknown as ModelDescriptor;
  assert.throws(() => validateDescriptor(invalid), /invalid type "bogus"/);
});

test('R3-S4: assertKnownColumn accepts a known column', () => {
  assert.doesNotThrow(() => assertKnownColumn(validDescriptor, 'name'));
});

test('R3-S4: assertKnownColumn rejects an unknown column', () => {
  assert.throws(
    () => assertKnownColumn(validDescriptor, 'nope'),
    /unknown column "nope"/,
  );
});