import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeRecord } from '../src/log.ts';
import { OP } from '../src/types.ts';
import type { DeleteRecord } from '../src/types.ts';

import { makeStore, readRawLog } from './helpers.ts';

// R4: delete.

const delRec = (key: string, seq: number): DeleteRecord => ({ op: OP.DELETE, key, seq });

test('R4-S1: delete existing key returns true, appends one DELETE record, removes from index', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('k', 'v');

  const result = store.delete('k');

  assert.equal(result, true);
  assert.equal(store.get('k'), undefined);
  assert.ok(readRawLog(filePath).toString('utf8').includes(encodeRecord(delRec('k', 2))));
});

test('R4-S2: delete missing key returns false and appends nothing (byte-length unchanged)', (t) => {
  const { store, path: filePath } = makeStore(t);
  const before = readRawLog(filePath).byteLength;

  const result = store.delete('k');

  assert.equal(result, false);
  assert.equal(readRawLog(filePath).byteLength, before);
});

test('R4-S3: repeat delete returns false and the log keeps exactly one DELETE record', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('k', 'v');
  assert.equal(store.delete('k'), true);

  assert.equal(store.delete('k'), false);

  const raw = readRawLog(filePath).toString('utf8');
  const occurrences = raw.split(encodeRecord(delRec('k', 2))).length - 1;
  assert.equal(occurrences, 1);
});