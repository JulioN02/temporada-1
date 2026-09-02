import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R7: delete(id) — true when a row was deleted, false when none matched.

test('R7-S1: delete returns true and removes the row', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'A');

  assert.equal(User.delete(1), true);
  assert.equal(User.findById(1), null);

  const raw = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  assert.ok(raw !== undefined);
  assert.equal(raw.n, 0);
});

test('R7-S2: delete returns false when the row does not exist', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'A');

  assert.equal(User.delete(999), false);

  const remaining = User.findById(1);
  assert.ok(remaining !== null);
  assert.equal(remaining.id, 1);
});