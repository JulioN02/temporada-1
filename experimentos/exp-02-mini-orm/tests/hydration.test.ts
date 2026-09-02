import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R11: hydration produces REAL class instances (never the null-prototype rows
// node:sqlite returns) and every query returns FRESH instances — no identity
// map; two reads of the same row share value but not identity.

test('R11-S1: findById and find return real class instances, not raw rows', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name, active, height) VALUES (?, ?, ?, ?)').run(1, 'Ana', 1, 1.65);

  const byId = User.findById(1);
  assert.ok(byId !== null);
  assert.ok(byId instanceof User);
  assert.notEqual(Object.getPrototypeOf(byId), null); // node:sqlite rows are null-prototype

  const all = User.find();
  assert.equal(all.length, 1);
  const row = all[0];
  assert.ok(row !== undefined);
  assert.ok(row instanceof User);
  assert.notEqual(Object.getPrototypeOf(row), null);
});

test('R11-S2: two reads of the same row are value-equal but not the same instance', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'Ana');

  const a = User.findById(1);
  const b = User.findById(1);
  assert.ok(a !== null && b !== null);
  assert.notEqual(a, b); // no shared identity
  assert.equal(a.id, b.id); // value-equal
  assert.equal(a.name, b.name);
});