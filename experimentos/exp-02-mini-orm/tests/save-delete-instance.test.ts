import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R8: instance save()/delete() — save() is update-only (D3): it persists the
// current field values via the instance PK, throws a descriptive error when the
// PK is missing, and NEVER upserts (create() is the only INSERT path).
// delete() mirrors the static delete. Both return booleans.

test('R8-S1: save() persists modified fields and returns true', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name, age) VALUES (?, ?, ?)').run(5, 'Ana', 20);

  const instance = User.findById(5);
  assert.ok(instance !== null);
  instance.name = 'New';

  assert.equal(instance.save(), true);

  const reloaded = User.findById(5);
  assert.ok(reloaded !== null);
  assert.equal(reloaded.name, 'New');
  assert.equal(reloaded.age, 20); // untouched fields survive

  const raw = db.prepare('SELECT name, age FROM users WHERE id = ?').get(5);
  assert.ok(raw !== undefined);
  assert.equal(raw.name, 'New');
  assert.equal(raw.age, 20);
});

test('R8-S2: save() without a primary key throws and writes nothing', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(1, 'Ana');

  const fresh = new User();
  assert.throws(() => fresh.save(), /primary key/);

  const raw = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  assert.ok(raw !== undefined);
  assert.equal(raw.n, 1); // nothing was written
});

test('R8-S3: save() never upserts — returns false and does not recreate a deleted row', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(5, 'Ana');

  const instance = User.findById(5);
  assert.ok(instance !== null);
  assert.equal(User.delete(5), true);

  assert.equal(instance.save(), false);
  assert.equal(User.findById(5), null); // the row was NOT recreated
});

test('R8-S4: instance delete() mirrors the static delete', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(5, 'Ana');

  const instance = User.findById(5);
  assert.ok(instance !== null);

  assert.equal(instance.delete(), true);
  assert.equal(User.findById(5), null);

  assert.equal(instance.delete(), false); // second delete, row already gone
});

test('R8 (design addition): instance delete() without a primary key throws a descriptive error', (t) => {
  const { User } = setupUserFixture(t);

  const fresh = new User();
  assert.throws(() => fresh.delete(), /primary key/);
});