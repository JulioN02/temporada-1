import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HEADER_LINE, encodeRecord } from '../src/log.ts';
import { OP } from '../src/types.ts';
import type { SetRecord } from '../src/types.ts';

import { makeStore, readRawLog } from './helpers.ts';

// R2: set.

const setRec = (key: string, value: string, seq: number): SetRecord => ({
  op: OP.SET,
  key,
  value,
  seq,
});

test('R2-S1: set appends a record, updates the index, returns void, seq starts at 1', (t) => {
  const { store, path: filePath } = makeStore(t);

  const result = store.set('a', '1');

  assert.equal(result, undefined); // void
  assert.equal(store.get('a'), '1');

  store.set('b', '2');
  store.set('c', '3');

  const raw = readRawLog(filePath).toString('utf8');
  assert.ok(raw.includes(encodeRecord(setRec('a', '1', 1))));
  assert.ok(raw.includes(encodeRecord(setRec('b', '2', 2))));
  assert.ok(raw.includes(encodeRecord(setRec('c', '3', 3))));
});

test('R2-S2: overwrite is last-write-wins — log keeps both SET records, get sees the newest', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('k', 'v1');
  store.set('k', 'v2');

  assert.equal(store.get('k'), 'v2');

  const raw = readRawLog(filePath).toString('utf8');
  assert.ok(raw.includes(encodeRecord(setRec('k', 'v1', 1))));
  assert.ok(raw.includes(encodeRecord(setRec('k', 'v2', 2))));
});

test('R2-S3: fsync before returning — the raw file already contains the exact SET line', (t) => {
  const { store, path: filePath } = makeStore(t);

  store.set('k', 'v');

  const raw = readRawLog(filePath).toString('utf8');
  assert.ok(raw.startsWith(HEADER_LINE));
  assert.ok(raw.includes(encodeRecord(setRec('k', 'v', 1))));
});