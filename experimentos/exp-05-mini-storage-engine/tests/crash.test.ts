import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { HEADER_LINE, encodeRecord, parseLog } from '../src/log.ts';
import { createStorage } from '../src/storage.ts';
import { OP } from '../src/types.ts';
import type { SetRecord } from '../src/types.ts';

import { makeDir, readRawLog, writeRawLog } from './helpers.ts';

/**
 * Crash-safety tests (R6 torn tail + R7 mid-file corruption).
 * T2 (pure parse): R6-S3, R7-S1, R7-S2 — handcrafted Buffers, no fs.
 * T4 (integration): R6-S1, R6-S2, R7-S1 — real files on disk.
 */

const setRec = (key: string, value: string, seq: number): SetRecord => ({
  op: OP.SET,
  key,
  value,
  seq,
});

// ── T2 · PURE parseLog sections ─────────────────────────────────────────────

test('R6-S1 (pure): partial trailing line without \\n yields truncateTo at the last valid boundary', () => {
  const a = setRec('a', '1', 1);
  const b = setRec('b', '2', 2);
  const raw = HEADER_LINE + encodeRecord(a) + encodeRecord(b) + '{"op":"SET","key":"k","va';
  const buf = Buffer.from(raw, 'utf8');

  const { records, truncateTo } = parseLog(buf);

  assert.deepEqual(records, [a, b]);
  assert.equal(truncateTo, Buffer.byteLength(HEADER_LINE + encodeRecord(a) + encodeRecord(b)));
});

test('R6-S1 (pure): torn tail mid-multibyte-char truncates at a byte boundary, never splits a character', () => {
  const a = setRec('k', 'ñandú — 你好 😀', 1);
  // Torn line: a record whose value starts with a multibyte emoji and is cut mid-character
  const raw = HEADER_LINE + encodeRecord(a) + '{"op":"SET","key":"x","value":"\u{1F600}';
  const buf = Buffer.from(raw, 'utf8');

  const { records, truncateTo } = parseLog(buf);

  assert.deepEqual(records, [a]);
  assert.equal(truncateTo, Buffer.byteLength(HEADER_LINE + encodeRecord(a)));
  // The offset is a native byte offset: everything after it (partial bytes included) is dropped
  assert.ok(truncateTo !== null && truncateTo <= buf.byteLength);
});

test('R6-S3 (pure): invalid JSON on the last \\n-terminated line yields truncateTo at that line start', () => {
  const a = setRec('a', '1', 1);
  const raw = HEADER_LINE + encodeRecord(a) + '{"op":"SET","key":"k","value":}\n';
  const buf = Buffer.from(raw, 'utf8');

  const { records, truncateTo } = parseLog(buf);

  assert.deepEqual(records, [a]);
  assert.equal(truncateTo, Buffer.byteLength(HEADER_LINE + encodeRecord(a)));
});

test('R7-S1 (pure): corrupted middle record throws with line and byte offset, never truncates', () => {
  const a = setRec('a', '1', 1);
  const b = setRec('b', '2', 2);
  const c = setRec('c', '3', 3);
  // Record b (line 3) has valid \n termination but broken JSON
  const raw = HEADER_LINE + encodeRecord(a) + '{"op":"SET","key":"b","value":}\n' + encodeRecord(c);
  const buf = Buffer.from(raw, 'utf8');

  assert.throws(
    () => parseLog(buf),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /corrupt record at line 3/);
      assert.match(err.message, /byte offset/);
      assert.match(err.message, new RegExp(String(Buffer.byteLength(HEADER_LINE + encodeRecord(a)))));
      return true;
    },
  );
});

test('R7-S2 (pure): garbage line between valid lines throws (not a torn tail)', () => {
  const a = setRec('a', '1', 1);
  const b = setRec('b', '2', 2);
  const raw = HEADER_LINE + encodeRecord(a) + 'THIS IS NOT JSON\n' + encodeRecord(b);
  const buf = Buffer.from(raw, 'utf8');

  assert.throws(() => parseLog(buf), /corrupt record at line 3/);
});

test('design-gap: valid JSON without trailing \\n on the final segment is always treated as torn', () => {
  const a = setRec('a', '1', 1);
  // encodeRecord(b) minus its \n → valid JSON, unterminated
  const raw = HEADER_LINE + encodeRecord(a) + encodeRecord(setRec('b', '2', 2)).slice(0, -1);
  const buf = Buffer.from(raw, 'utf8');

  const { records, truncateTo } = parseLog(buf);

  assert.deepEqual(records, [a]);
  assert.equal(truncateTo, Buffer.byteLength(HEADER_LINE + encodeRecord(a)));
});

// ── T4 · INTEGRATION on real files ──────────────────────────────────────────

test('R6-S1 (integration): torn tail is physically truncated to the last valid \\n boundary', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'torn.log');
  const a = setRec('a', '1', 1);
  const b = setRec('b', '2', 2);
  const validPrefix = HEADER_LINE + encodeRecord(a) + encodeRecord(b);
  writeRawLog(filePath, validPrefix + '{"op":"SET","key":"k","va');

  const store = createStorage(filePath);

  assert.equal(store.get('a'), '1');
  assert.equal(store.get('b'), '2');
  assert.equal(store.get('k'), undefined);
  assert.equal(readRawLog(filePath).byteLength, Buffer.byteLength(validPrefix));
  store.close();
});

test('R6-S2 (integration): truncation happens before serving — next append starts at the boundary', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'torn2.log');
  const a = setRec('a', '1', 1);
  const validPrefix = HEADER_LINE + encodeRecord(a);
  writeRawLog(filePath, validPrefix + '{"op":"SET","key":"k","va');

  const store = createStorage(filePath);
  store.set('c', '3'); // must append right after the truncated boundary

  assert.equal(store.get('c'), '3');
  assert.equal(readRawLog(filePath).toString('utf8'), validPrefix + encodeRecord(setRec('c', '3', 2)));
  store.close();
});

test('R6-S3 (integration): invalid JSON on the last line is discarded, earlier records intact', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'bad-last.log');
  const a = setRec('a', '1', 1);
  const validPrefix = HEADER_LINE + encodeRecord(a);
  writeRawLog(filePath, validPrefix + '{"op":"SET","key":"k","value":}\n');

  const store = createStorage(filePath);

  assert.equal(store.get('a'), '1');
  assert.equal(store.get('k'), undefined);
  assert.equal(readRawLog(filePath).byteLength, Buffer.byteLength(validPrefix));
  store.close();
});

test('R7-S1 (integration): corrupted middle record throws, file bytes left untouched', (t) => {
  const dir = makeDir(t);
  const filePath = path.join(dir, 'corrupt.log');
  const a = setRec('a', '1', 1);
  const c = setRec('c', '3', 3);
  const raw = HEADER_LINE + encodeRecord(a) + '{"op":"SET","key":"b","value":}\n' + encodeRecord(c);
  writeRawLog(filePath, raw);
  const bytesBefore = Buffer.byteLength(raw);

  assert.throws(() => createStorage(filePath), /corrupt record at line 3/);

  assert.equal(readRawLog(filePath).byteLength, bytesBefore); // never truncated
});