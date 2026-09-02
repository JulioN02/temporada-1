import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R2 (axiom 2): injection impossible by construction — user values travel ONLY
// as bound parameters; identifiers come ONLY from the descriptor. Integration-
// level proof: a classic injection payload must round-trip verbatim through
// create/find/update and never execute.

test('R2-S1: an SQL injection payload round-trips verbatim and never executes', (t) => {
  const { db, User } = setupUserFixture(t);
  const payload = "Robert'); DROP TABLE users;--";

  const created = User.create({ name: payload, email: payload, active: true });
  assert.ok(created instanceof User);
  assert.equal(created.name, payload);
  assert.equal(created.email, payload);
  assert.equal(created.active, true);

  // The payload as criteria: bound, not interpolated — it finds the row.
  const found = User.find({ where: { name: payload } });
  assert.equal(found.length, 1);
  const hit = found[0];
  assert.ok(hit !== undefined);
  assert.equal(hit.email, payload);

  // The payload as patch value: bound, not interpolated.
  const updated = User.update(created.id, { name: payload });
  assert.ok(updated !== null);
  assert.equal(updated.name, payload);

  // The table still exists and holds exactly the one row: DROP never ran.
  const raw = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  assert.ok(raw !== undefined);
  assert.equal(raw.n, 1);
  assert.equal(User.find().length, 1);
});