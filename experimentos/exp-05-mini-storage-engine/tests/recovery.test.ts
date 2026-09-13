import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { replay } from '../src/recovery.ts';
import { createStorage } from '../src/storage.ts';
import { encodeRecord } from '../src/log.ts';
import { OP } from '../src/types.ts';
import type { DeleteRecord, LogRecord, SetRecord } from '../src/types.ts';

import { makeDir, makeStore, readRawLog } from './helpers.ts';

/**
 * Recovery tests (R5): replay rebuilds state, order matters, seq continues.
 * T3 (pure): replay() unit tests. T4 (integration): real open/close cycles.
 */

const setRec = (key: string, value: string, seq: number): SetRecord => ({
  op: OP.SET,
  key,
  value,
  seq,
});
const delRec = (key: string, seq: number): DeleteRecord => ({ op: OP.DELETE, key, seq });

// ── T3 · PURE replay unit tests ─────────────────────────────────────────────

test('R5-S1 (pure): replay rebuilds index state from SET records', () => {
  const records: LogRecord[] = [setRec('a', '1', 1), setRec('b', '2', 2)];

  const { index, lastSeq } = replay(records);

  assert.equal(index.get('a'), '1');
  assert.equal(index.get('b'), '2');
  assert.equal(index.size, 2);
  assert.equal(lastSeq, 2);
});

test('R5-S2 (pure): SET-then-DELETE removes the key, DELETE-then-SET restores it', () => {
  const setThenDelete: LogRecord[] = [setRec('k', 'v', 1), delRec('k', 2)];
  const { index: indexA, lastSeq: lastSeqA } = replay(setThenDelete);
  assert.equal(indexA.get('k'), undefined);
  assert.equal(indexA.size, 0);
  assert.equal(lastSeqA, 2);

  const deleteThenSet: LogRecord[] = [delRec('k', 1), setRec('k', 'v2', 2)];
  const { index: indexB, lastSeq: lastSeqB } = replay(deleteThenSet);
  assert.equal(indexB.get('k'), 'v2');
  assert.equal(indexB.size, 1);
  assert.equal(lastSeqB, 2);
});

test('R5-S2 (pure): overwrite is last-write-wins in file order', () => {
  const records: LogRecord[] = [setRec('k', 'v1', 1), setRec('k', 'v2', 2), setRec('k', 'v3', 3)];
  const { index } = replay(records);
  assert.equal(index.get('k'), 'v3');
});

test('R5-S3 (pure): lastSeq is the max seq seen (0 for no records)', () => {
  assert.equal(replay([]).lastSeq, 0);
  assert.equal(replay([setRec('a', '1', 1), setRec('b', '2', 3)]).lastSeq, 3);
});

// ── T4 · INTEGRATION on real files ──────────────────────────────────────────

test('R5-S1 (integration): reopen preserves state', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('a', '1');
  store.set('b', '2');
  store.close();

  const reopened = createStorage(filePath);
  assert.equal(reopened.get('a'), '1');
  assert.equal(reopened.get('b'), '2');
  reopened.close();
});

test('R5-S2 (integration): SET-then-DELETE reopens with the key absent', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('k', 'v');
  store.delete('k');
  store.close();

  const reopened = createStorage(filePath);
  assert.equal(reopened.get('k'), undefined);
  reopened.close();
});

test('R5-S2 (integration): inverse order — delete absent then set — reopens with the value', (t) => {
  const { store, path: filePath } = makeStore(t);
  assert.equal(store.delete('k'), false); // no record appended
  store.set('k', 'v2');
  store.close();

  const reopened = createStorage(filePath);
  assert.equal(reopened.get('k'), 'v2');
  reopened.close();
});

test('R5-S3 (integration): sequence continues at max+1 across restart (never repeats)', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('a', '1');
  store.set('b', '2');
  store.set('c', '3');
  store.close();

  const reopened = createStorage(filePath);
  reopened.set('x', 'y');

  assert.ok(readRawLog(filePath).toString('utf8').includes(encodeRecord(setRec('x', 'y', 4))));
  reopened.close();
});

test('R5-S4 (integration): 5× open/close loops with interleaved writes stay stable', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'loop.log');

  let store = createStorage(filePath);
  for (let i = 0; i < 5; i++) {
    store.set(`k${i}`, `v${i}`);
    store.close();
    store = createStorage(filePath);
  }

  for (let i = 0; i < 5; i++) {
    assert.equal(store.get(`k${i}`), `v${i}`);
  }
  store.set('after', 'ok'); // further writes still work
  assert.equal(store.get('after'), 'ok');
  store.close();
});