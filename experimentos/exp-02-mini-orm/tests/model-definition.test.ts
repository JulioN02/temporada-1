import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R1: createModel returns a real class; the descriptor is the single source
// of truth — the ORM never guesses types from data (R1-S2).

test('R1-S1: createModel returns a class with the read statics from the descriptor', (t) => {
  const { User } = setupUserFixture(t);
  assert.equal(typeof User, 'function');
  assert.equal(typeof User.find, 'function');
  assert.equal(typeof User.findById, 'function');
  const instance = new User();
  assert.ok(instance instanceof User);
});

test('R1-S2: a stored string "42" hydrates as string, never coerced to number', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (name) VALUES (?)').run('42');

  const row = User.findById(1);
  assert.ok(row !== null);
  assert.equal(row.name, '42');
  assert.equal(typeof row.name, 'string');
});