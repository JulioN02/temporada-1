import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R6: update(id, patch) — partial update (only listed columns, coerced),
// returns the hydrated updated instance; null when the row does not exist.

test('R6-S1: update applies a partial update and returns the hydrated row', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name, age) VALUES (?, ?, ?)').run(3, 'A', 20);

  const updated = User.update(3, { age: 21 });
  assert.ok(updated !== null);
  assert.ok(updated instanceof User);
  assert.equal(updated.age, 21);
  assert.equal(updated.name, 'A');

  const raw = db.prepare('SELECT name, age FROM users WHERE id = ?').get(3);
  assert.ok(raw !== undefined);
  assert.equal(raw.name, 'A');
  assert.equal(raw.age, 21);
});

test('R6-S2: update returns null and changes nothing when the row is missing', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'A');

  assert.equal(User.update(999, { name: 'x' }), null);

  const remaining = User.find();
  assert.equal(remaining.length, 1);
  assert.deepEqual(remaining.map((r) => r.name), ['A']);
});