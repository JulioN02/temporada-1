import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupUserFixture } from './helpers.ts';

// R3: find(criteria?) — where is equality AND; orderBy/limit optional; no
// matches -> []; unknown column -> descriptive error.

test('R3-S1: filter + orderBy + limit returns only matching rows in order', (t) => {
  const { db, User } = setupUserFixture(t);
  const seed = (name: string, active: number) =>
    db.prepare('INSERT INTO users (name, active) VALUES (?, ?)').run(name, active);
  // Seeded out of alphabetical order to prove ORDER BY actually sorts.
  seed('Ema', 1);
  seed('Beto', 0);
  seed('Caro', 1);
  seed('Dani', 0);
  seed('Ana', 1);

  const result = User.find({ where: { active: true }, orderBy: 'name', limit: 2 });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.name), ['Ana', 'Caro']);
  assert.ok(result.every((r) => r instanceof User));
  assert.ok(result.every((r) => r.active === true));
});

test('R3-S2: find() with no criteria returns every row', (t) => {
  const { db, User } = setupUserFixture(t);
  const seed = (name: string) => db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
  seed('Ana');
  seed('Beto');
  seed('Caro');

  const result = User.find();
  assert.equal(result.length, 3);
  // Without orderBy the row order is DB-defined; compare as a sorted set.
  assert.deepEqual(result.map((r) => r.name).sort(), ['Ana', 'Beto', 'Caro']);
  assert.ok(result.every((r) => r instanceof User));
});

test('R3-S3: no matches returns an empty array', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (name) VALUES (?)').run('Ana');

  const result = User.find({ where: { name: 'ghost' } });
  assert.deepEqual(result, []);
});

test('R3-S4: unknown column in where throws a descriptive error', (t) => {
  const { db, User } = setupUserFixture(t);
  db.prepare('INSERT INTO users (name) VALUES (?)').run('Ana');

  assert.throws(() => User.find({ where: { nope: 1 } }), /unknown column "nope"/);
  // The failed query must not corrupt the model: a follow-up find still works.
  assert.equal(User.find().length, 1);
});