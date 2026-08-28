import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractExtension } from '../src/classify.ts';
import { DEFAULT_MAPPING } from '../src/config.ts';

test('classify maps known extensions to their category (R2)', () => {
  assert.deepEqual(classify('report.pdf', DEFAULT_MAPPING), { kind: 'category', category: 'PDF' });
  assert.deepEqual(classify('photo.png', DEFAULT_MAPPING), { kind: 'category', category: 'Images' });
  assert.deepEqual(classify('main.ts', DEFAULT_MAPPING), { kind: 'category', category: 'Code' });
  assert.deepEqual(classify('archive.zip', DEFAULT_MAPPING), { kind: 'category', category: 'Archives' });
  assert.deepEqual(classify('notes.md', DEFAULT_MAPPING), { kind: 'category', category: 'Documents' });
});

test('classify is case-insensitive (R3)', () => {
  assert.deepEqual(classify('REPORT.PDF', DEFAULT_MAPPING), { kind: 'category', category: 'PDF' });
});

test('classify uses only the last extension (R3)', () => {
  assert.deepEqual(classify('archive.tar.gz', DEFAULT_MAPPING), { kind: 'category', category: 'Archives' });
});

test('classify sends unknown extensions to misc (R4)', () => {
  assert.deepEqual(classify('data.bin', DEFAULT_MAPPING), { kind: 'misc' });
});

test('classify sends files without extension to misc (R4)', () => {
  assert.deepEqual(classify('LICENSE', DEFAULT_MAPPING), { kind: 'misc' });
});

test('classify is deterministic: same input always yields same output (R1)', () => {
  const first = classify('photo.png', DEFAULT_MAPPING);
  const second = classify('photo.png', DEFAULT_MAPPING);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { kind: 'category', category: 'Images' });
});

test('extractExtension returns lowercase extension or null (R3)', () => {
  assert.equal(extractExtension('REPORT.PDF'), 'pdf');
  assert.equal(extractExtension('archive.tar.gz'), 'gz');
  assert.equal(extractExtension('LICENSE'), null);
  assert.equal(extractExtension('.env'), null);
});

test('classify sends dotfiles to misc when the dot is leading (R7 partial)', () => {
  assert.deepEqual(classify('.env', DEFAULT_MAPPING), { kind: 'misc' });
});

test('classify returns skip for unknown/no-extension files when omitMisc is set (R5)', () => {
  assert.deepEqual(classify('data.bin', DEFAULT_MAPPING, true), { kind: 'skip' });
  assert.deepEqual(classify('LICENSE', DEFAULT_MAPPING, true), { kind: 'skip' });
  assert.deepEqual(classify('.env', DEFAULT_MAPPING, true), { kind: 'skip' });
});

test('classify still returns categories when omitMisc is set (R5)', () => {
  assert.deepEqual(classify('report.pdf', DEFAULT_MAPPING, true), { kind: 'category', category: 'PDF' });
});

test('classify looks up the lowercase extension against the mapping keys (R3)', () => {
  assert.deepEqual(classify('photo.PNG', { png: 'Fotos' }), { kind: 'category', category: 'Fotos' });
});