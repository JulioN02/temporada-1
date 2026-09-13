import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeStore } from './helpers.ts';

// R9: API contract & errors.

test('R9-S1: API shape — exactly get/set/delete/close as functions', (t) => {
  const { store } = makeStore(t);

  assert.equal(typeof store.get, 'function');
  assert.equal(typeof store.set, 'function');
  assert.equal(typeof store.delete, 'function');
  assert.equal(typeof store.close, 'function');
  assert.deepEqual(Object.keys(store).sort(), ['close', 'delete', 'get', 'set']);
});

test('R9-S2: operations on a closed store throw (never silently no-op)', (t) => {
  const { store } = makeStore(t);
  store.close();

  assert.throws(() => store.get('a'), /closed/i);
  assert.throws(() => store.set('a', '1'), /closed/i);
  assert.throws(() => store.delete('a'), /closed/i);
  assert.throws(() => store.close(), /closed/i);
});

test('R9-S3: non-string runtime inputs throw TypeError', (t) => {
  const { store } = makeStore(t);

  const setAsUnknown = store.set as (key: unknown, value: unknown) => void;
  const getAsUnknown = store.get as (key: unknown) => unknown;
  const deleteAsUnknown = store.delete as (key: unknown) => unknown;

  assert.throws(() => setAsUnknown(42, 'x'), TypeError);
  assert.throws(() => setAsUnknown('x', 42), TypeError);
  assert.throws(() => setAsUnknown('x', null), TypeError);
  assert.throws(() => getAsUnknown(null), TypeError);
  assert.throws(() => deleteAsUnknown(undefined), TypeError);
});