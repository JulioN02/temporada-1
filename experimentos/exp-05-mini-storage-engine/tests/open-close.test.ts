import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { createStorage } from '../src/storage.ts';
import { HEADER_LINE, encodeRecord } from '../src/log.ts';
import { OP } from '../src/types.ts';
import type { SetRecord } from '../src/types.ts';

import { makeDir, makeStore, readRawLog, writeRawLog } from './helpers.ts';

// R1: open / recovery at open.

const setRec = (key: string, value: string, seq: number): SetRecord => ({
  op: OP.SET,
  key,
  value,
  seq,
});

test('R1-S1: create-if-missing — file is created and the store is empty', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'fresh.log');
  assert.equal(existsSync(filePath), false);

  const store = createStorage(filePath);

  assert.equal(existsSync(filePath), true);
  assert.equal(store.get('anything'), undefined);
  store.close();
});

test('R1-S2: empty file is a fresh store — the next set() writes a header + record', (t) => {
  const { store, path: filePath } = makeStore(t);
  assert.equal(readRawLog(filePath).byteLength, 0);
  assert.equal(store.get('a'), undefined);

  store.set('a', '1');

  assert.equal(readRawLog(filePath).toString('utf8'), HEADER_LINE + encodeRecord(setRec('a', '1', 1)));
});

test('R1-S3: invalid header throws loudly and no usable store is returned', (t) => {
  const dir = makeDir(t);

  const badMagic = path.join(dir, 'bad-magic.log');
  writeRawLog(badMagic, '{"magic":"WRONG","version":1}\n');
  assert.throws(() => createStorage(badMagic), /header/i);

  const badVersion = path.join(dir, 'bad-version.log');
  writeRawLog(badVersion, '{"magic":"JSMKV1","version":2}\n');
  assert.throws(() => createStorage(badVersion), /header/i);

  const partial = path.join(dir, 'partial.log');
  writeRawLog(partial, '{"magic":"JSMKV1","ver');
  assert.throws(() => createStorage(partial), /header/i);
});

test('R1-S4: double close() — first succeeds (file fully written), second throws', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('a', '1');

  store.close();

  // First close leaves a fully written + parseable file
  assert.ok(readRawLog(filePath).toString('utf8').startsWith(HEADER_LINE));
  assert.throws(() => store.close(), /closed/i);
});