import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R4: findById(id) — hydrated instance or null; a missing/undefined id is a
// programming error and throws a descriptive error (R4-S3).

test('R4-S1: findById returns a hydrated instance with the requested id', (t) => {
  const { db, User } = setupUserFixture(t);
  const insert = db.prepare('INSERT INTO users (name) VALUES (?)');
  for (let i = 1; i <= 7; i++) insert.run(`user ${i}`);

  const row = User.findById(7);
  assert.ok(row !== null);
  assert.ok(row instanceof User);
  assert.equal(row.id, 7);
  assert.equal(row.name, 'user 7');
});

test('R4-S2: findById returns null when the row does not exist', (t) => {
  const { User } = setupUserFixture(t);
  assert.equal(User.findById(999), null);
});

test('R4-S3: findById(undefined) throws a descriptive error', (t) => {
  const { User } = setupUserFixture(t);
  assert.throws(() => User.findById(undefined), /requires a non-null id/);
});

test('R4-S3: findById(null) throws a descriptive error', (t) => {
  const { User } = setupUserFixture(t);
  assert.throws(() => User.findById(null), /requires a non-null id/);
});