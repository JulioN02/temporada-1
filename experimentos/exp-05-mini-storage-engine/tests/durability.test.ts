import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { HEADER_LINE, encodeRecord, parseLog } from '../src/log.ts';
import { createStorage } from '../src/storage.ts';
import { OP } from '../src/types.ts';
import type { DeleteRecord, SetRecord } from '../src/types.ts';

import { makeDir, makeStore, readRawLog } from './helpers.ts';

/**
 * Durability tests (R8): byte-length monotonicity, seq never repeats, and the
 * closed file parses byte-exactly. T2 (pure): encodeRecord↔parseLog round-trip
 * + header validation. T4 (integration): R8-S1..S3 on real files.
 */

const setRec = (key: string, value: string, seq: number): SetRecord => ({
  op: OP.SET,
  key,
  value,
  seq,
});
const delRec = (key: string, seq: number): DeleteRecord => ({ op: OP.DELETE, key, seq });

// ── T2 · PURE format round-trip + header validation ─────────────────────────

test('R8-S3 (pure): SET record with newline/quote key+value round-trips byte-exact', () => {
  const rec = setRec('a\nb', '"quoted"\nsecond line', 1);
  const line = encodeRecord(rec);

  assert.ok(line.endsWith('\n'));
  // JSON.stringify escapes the inner newlines → the on-disk line is a single physical line
  assert.equal(line.slice(0, -1).includes('\n'), false);

  const { records, truncateTo } = parseLog(Buffer.from(HEADER_LINE + line, 'utf8'));
  assert.equal(truncateTo, null);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], rec);
});

test('R8-S3 (pure): multibyte UTF-8 value round-trips byte-exact', () => {
  const rec = setRec('k', 'ñandú — 你好 😀', 1);
  const line = encodeRecord(rec);

  const { records, truncateTo } = parseLog(Buffer.from(HEADER_LINE + line, 'utf8'));
  assert.equal(truncateTo, null);
  assert.deepEqual(records, [rec]);
});

test('R8-S3 (pure): DELETE record round-trips byte-exact', () => {
  const rec = delRec('k', 2);
  const line = encodeRecord(rec);

  const { records, truncateTo } = parseLog(Buffer.from(HEADER_LINE + line, 'utf8'));
  assert.equal(truncateTo, null);
  assert.deepEqual(records, [rec]);
});

test('R1-S2 (pure): empty buffer parses to a fresh store', () => {
  assert.deepEqual(parseLog(Buffer.alloc(0)), { records: [], truncateTo: null });
});

test('R1-S3 (pure): header-only file parses to an empty store (no records, no truncation)', () => {
  const { records, truncateTo } = parseLog(Buffer.from(HEADER_LINE, 'utf8'));
  assert.deepEqual(records, []);
  assert.equal(truncateTo, null);
});

test('R1-S3 (pure): bad magic in header throws', () => {
  const buf = Buffer.from('{"magic":"NOPE","version":1}\n', 'utf8');
  assert.throws(() => parseLog(buf), /header/i);
});

test('R1-S3 (pure): bad version in header throws', () => {
  const buf = Buffer.from('{"magic":"JSMKV1","version":2}\n', 'utf8');
  assert.throws(() => parseLog(buf), /header/i);
});

test('R1-S3 (pure): partial (torn) header throws, never truncates', () => {
  const buf = Buffer.from('{"magic":"JSMKV1","vers', 'utf8');
  assert.throws(() => parseLog(buf), /header/i);
});

test('R1-S3 (pure): non-JSON first line throws', () => {
  const buf = Buffer.from('this is not json\n', 'utf8');
  assert.throws(() => parseLog(buf), /header/i);
});

// ── T4 · INTEGRATION on real files ──────────────────────────────────────────

test('R8-S1 (integration): byte-length strictly increases and earlier prefix bytes never change', (t) => {
  const { store, path: filePath } = makeStore(t);
  let prevRaw: Buffer = Buffer.alloc(0);

  for (let i = 0; i < 5; i++) {
    store.set(`k${i}`, `v${i}`);
    const raw = readRawLog(filePath);
    assert.ok(raw.byteLength > prevRaw.byteLength, 'byte length must strictly increase');
    assert.deepEqual(raw.subarray(0, prevRaw.byteLength), prevRaw); // prefix preserved
    prevRaw = raw;
  }
});

test('R8-S2 (integration): seq never repeats and never resets across restarts', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'seq.log');

  let store = createStorage(filePath);
  store.set('a', '1');
  store.set('b', '2');
  store.close();

  store = createStorage(filePath);
  store.set('c', '3');
  store.close();

  store = createStorage(filePath);
  store.delete('a');
  store.close();

  const seqs: number[] = [];
  for (const line of readRawLog(filePath).toString('utf8').split('\n')) {
    if (line.length === 0) continue; // skip header line and final terminator
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null && 'seq' in parsed) {
      const seq = (parsed as Record<string, unknown>).seq;
      if (typeof seq === 'number') seqs.push(seq);
    }
  }

  assert.deepEqual(seqs, [1, 2, 3, 4]);
  assert.equal(new Set(seqs).size, seqs.length); // no duplicates
});

test('R8-S3 (integration): closed store file parses byte-exact — header first, \\n-terminated records', (t) => {
  const { store, path: filePath } = makeStore(t);
  store.set('a', '1');
  store.set('b', '2');
  store.delete('a');
  store.close();

  const raw = readRawLog(filePath).toString('utf8');
  assert.equal(
    raw,
    HEADER_LINE +
      encodeRecord({ op: OP.SET, key: 'a', value: '1', seq: 1 }) +
      encodeRecord({ op: OP.SET, key: 'b', value: '2', seq: 2 }) +
      encodeRecord({ op: OP.DELETE, key: 'a', seq: 3 }),
  );

  // And it replays to the same logical state
  const reopened = createStorage(filePath);
  assert.equal(reopened.get('b'), '2');
  assert.equal(reopened.get('a'), undefined);
  reopened.close();
});