import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupThingsFixture } from './helpers.ts';

// R9 (D4): absence is a normal data state — findById -> null, find -> [],
// update -> null, delete -> false. None of them throw.
// The fixture declares a column `x` so find({where:{x:1}}) returns [] instead
// of hitting the unknown-column throw of R3-S4.

test('R9-S1: not-found contract — null, [], null, false without errors', (t) => {
  const { Thing } = setupThingsFixture(t); // empty table

  assert.equal(Thing.findById(1), null);
  assert.deepEqual(Thing.find({ where: { x: 1 } }), []);
  assert.equal(Thing.update(1, {}), null); // empty patch = no-op (AD-4)
  assert.equal(Thing.delete(1), false);
});