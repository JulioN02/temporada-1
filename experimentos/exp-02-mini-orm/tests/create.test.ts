import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R5: create(data) — insert via prepared statement, values coerced per the
// descriptor, returns the hydrated instance including the generated PK
// (autoincrement). Omitted columns follow the DB schema (DB decides).

test('R5-S1: create returns an instance with the generated PK and persists the row', (t) => {
  const { db, User } = setupUserFixture(t);

  const created = User.create({ name: 'Ana', active: true });
  assert.ok(created instanceof User);
  assert.equal(created.id, 1);
  assert.equal(created.name, 'Ana');
  assert.equal(created.active, true);

  const persisted = db.prepare('SELECT name, active FROM users WHERE id = ?').get(1);
  assert.ok(persisted !== undefined);
  assert.equal(persisted.name, 'Ana');
  assert.equal(persisted.active, 1);
});

test('R5-S2: create coerces booleans to integer 1 in storage', (t) => {
  const { db, User } = setupUserFixture(t);

  const created = User.create({ active: true });
  assert.equal(created.id, 1);

  const raw = db.prepare('SELECT active FROM users WHERE id = ?').get(1);
  assert.ok(raw !== undefined);
  assert.equal(raw.active, 1);
  assert.equal(typeof raw.active, 'number');

  assert.equal(User.findById(1)?.active, true);
});