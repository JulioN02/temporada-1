import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAPPING, mergeMapping } from '../src/config.ts';

test('DEFAULT_MAPPING covers the 7 built-in categories (R2)', () => {
  const categories: Set<string> = new Set(Object.values(DEFAULT_MAPPING));
  for (const expected of ['PDF', 'Images', 'Videos', 'Audio', 'Code', 'Documents', 'Archives']) {
    assert.ok(categories.has(expected), `missing category ${expected}`);
  }
  assert.equal(DEFAULT_MAPPING.pdf, 'PDF');
  assert.equal(DEFAULT_MAPPING.png, 'Images');
  assert.equal(DEFAULT_MAPPING.mp4, 'Videos');
  assert.equal(DEFAULT_MAPPING.mp3, 'Audio');
  assert.equal(DEFAULT_MAPPING.ts, 'Code');
  assert.equal(DEFAULT_MAPPING.md, 'Documents');
  assert.equal(DEFAULT_MAPPING.zip, 'Archives');
});

test('DEFAULT_MAPPING keys are normalized to lowercase without leading dots', () => {
  const keys = Object.keys(DEFAULT_MAPPING);
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.equal(key, key.toLowerCase(), `key ${key} must be lowercase`);
    assert.ok(!key.startsWith('.'), `key ${key} must not start with a dot`);
  }
});

test('mergeMapping overrides defaults per extension and keeps the rest (R6)', () => {
  const merged = mergeMapping(DEFAULT_MAPPING, { py: 'Python' });
  assert.equal(merged.py, 'Python');
  assert.equal(merged.pdf, 'PDF');
});

test('mergeMapping extends the mapping with new extensions (R6)', () => {
  const merged = mergeMapping(DEFAULT_MAPPING, { abc: 'Custom' });
  assert.equal(merged.abc, 'Custom');
  assert.equal(merged.ts, 'Code');
});

test('mergeMapping is pure: does not mutate the defaults (R6)', () => {
  const snapshot = { ...DEFAULT_MAPPING };
  mergeMapping(DEFAULT_MAPPING, { py: 'Python' });
  assert.deepEqual(DEFAULT_MAPPING, snapshot);
});