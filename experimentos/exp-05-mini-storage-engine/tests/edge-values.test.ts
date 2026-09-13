import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStorage } from '../src/storage.ts';

import { makeStore } from './helpers.ts';

// R3: get + edge values round-trip byte-exactly.

test('R3-S1: existing key returns its value', (t) => {
  const { store } = makeStore(t);
  store.set('user:1', 'Ana');
  assert.equal(store.get('user:1'), 'Ana');
});

test('R3-S2: missing key returns undefined without throwing', (t) => {
  const { store } = makeStore(t);
  assert.equal(store.get('nope'), undefined);
});

test('R3-S3: empty string value returns "" (not undefined)', (t) => {
  const { store } = makeStore(t);
  store.set('k', '');
  assert.equal(store.get('k'), '');
});

test('R3-S4: UTF-8 multibyte values round-trip exactly across close/reopen', (t) => {
  const { store, path: filePath } = makeStore(t);
  const value = 'ñandú — 你好 😀';
  store.set('k', value);
  store.close();

  const reopened = createStorage(filePath);
  assert.equal(reopened.get('k'), value);
  reopened.close();
});

test('R3-S5: special-char keys, newlines, quotes, JSON-like text and ~100 KB values round-trip byte-exact', (t) => {
  const { store, path: filePath } = makeStore(t);
  const cases: Array<[string, string]> = [
    ['a\nb', 'value with newline'],
    ['"q"', '{"nested":"json","like":true}'],
    ['key with spaces', 'línea con ñ — 中文'],
    ['big', 'x'.repeat(100_000) + '\nwith\nnewlines'],
  ];

  for (const [key, value] of cases) {
    store.set(key, value);
    assert.equal(store.get(key), value);
  }

  // Reopen to prove the on-disk encoding (not just the Map) is unambiguous
  store.close();
  const reopened = createStorage(filePath);
  for (const [key, value] of cases) {
    assert.equal(reopened.get(key), value);
  }
  reopened.close();
});