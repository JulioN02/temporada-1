import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAPPING, mergeMapping, parseFileConfig, ConfigError } from '../src/config.ts';
import type { CliOptions } from '../src/config.ts';

// loadConfig is resolved via dynamic import until T3.4 implements it; this
// keeps intermediate GREEN states meaningful (parseFileConfig tests pass alone).
async function loadConfigVia(targetDir: string, cwd: string, cli: CliOptions) {
  const { loadConfig } = await import('../src/config.ts');
  return loadConfig(targetDir, cwd, cli);
}

function cliFor(targetDir: string, configPath?: string): CliOptions {
  return { targetDir, configPath, dryRun: false, includeHidden: false };
}

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

// ---------------------------------------------------------------------------
// Phase 3 — validation (R18)
// ---------------------------------------------------------------------------

test('parseFileConfig rejects unknown top-level keys (R18)', () => {
  assert.throws(() => parseFileConfig({ mapping: {}, extra: 1 }, 'src'), ConfigError);
});

test('parseFileConfig rejects non-string mapping values (R18)', () => {
  assert.throws(() => parseFileConfig({ mapping: { pdf: 123 } }, 'src'), ConfigError);
  assert.throws(() => parseFileConfig({ mapping: { pdf: '' } }, 'src'), ConfigError);
});

test('parseFileConfig rejects mapping keys that become empty after normalization (R18)', () => {
  assert.throws(() => parseFileConfig({ mapping: { '.': 'X' } }, 'src'), ConfigError);
  assert.throws(() => parseFileConfig({ mapping: { '..': 'X' } }, 'src'), ConfigError);
});

test('parseFileConfig rejects miscFolder with path separators (R18)', () => {
  assert.throws(() => parseFileConfig({ miscFolder: 'a/b' }, 'src'), ConfigError);
  assert.throws(() => parseFileConfig({ miscFolder: 'a\\b' }, 'src'), ConfigError);
});

test('parseFileConfig rejects miscFolder equal to "." or ".." (R18)', () => {
  assert.throws(() => parseFileConfig({ miscFolder: '.' }, 'src'), ConfigError);
  assert.throws(() => parseFileConfig({ miscFolder: '..' }, 'src'), ConfigError);
});

test('parseFileConfig rejects non-string miscFolder and non-boolean omitMisc (R18)', () => {
  assert.throws(() => parseFileConfig({ miscFolder: 42 }, 'src'), ConfigError);
  assert.throws(() => parseFileConfig({ omitMisc: 'yes' }, 'src'), ConfigError);
});

test('parseFileConfig normalizes mapping keys and passes through valid values (R18)', () => {
  const parsed = parseFileConfig(
    { mapping: { PDF: 'X', '.md': 'Docs' }, miscFolder: 'Otros', omitMisc: true },
    'src',
  );
  assert.deepEqual(parsed, { mapping: { pdf: 'X', md: 'Docs' }, miscFolder: 'Otros', omitMisc: true });
});

test('parseFileConfig accepts an empty mapping object', () => {
  assert.deepEqual(parseFileConfig({ mapping: {} }, 'src'), { mapping: {} });
});

test('loadConfig throws ConfigError on malformed JSON (R18)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fo-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, '.file-organizer.json'), '{ not json', 'utf8');
  await assert.rejects(loadConfigVia(dir, dir, cliFor(dir)), ConfigError);
});

test('loadConfig throws ConfigError when --config path does not exist (R18)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fo-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = join(dir, 'missing.json');
  await assert.rejects(loadConfigVia(dir, dir, cliFor(dir, missing)), ConfigError);
});

// ---------------------------------------------------------------------------
// Phase 3 — precedence chain (R17) and ignored list (R9)
// ---------------------------------------------------------------------------

test('loadConfig resolves precedence: defaults < cwd < target < --config (R17)', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'fo-cwd-'));
  const target = await mkdtemp(join(tmpdir(), 'fo-target-'));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(join(cwd, '.file-organizer.json'), JSON.stringify({ miscFolder: 'CwdMisc', mapping: { pdf: 'CwdPdf' } }), 'utf8');
  await writeFile(join(target, '.file-organizer.json'), JSON.stringify({ miscFolder: 'TargetMisc' }), 'utf8');

  const config = await loadConfigVia(target, cwd, cliFor(target));
  assert.equal(config.miscFolder, 'TargetMisc'); // target beats cwd
  assert.equal(config.mapping.pdf, 'CwdPdf'); // cwd mapping merges in
  assert.equal(config.mapping.ts, 'Code'); // defaults intact
});

test('loadConfig applies --config as the highest layer (R17)', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'fo-cwd-'));
  const target = await mkdtemp(join(tmpdir(), 'fo-target-'));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  const configPath = join(cwd, 'explicit.json');
  await writeFile(join(target, '.file-organizer.json'), JSON.stringify({ miscFolder: 'TargetMisc' }), 'utf8');
  await writeFile(configPath, JSON.stringify({ miscFolder: 'ExplicitMisc', omitMisc: true }), 'utf8');

  const config = await loadConfigVia(target, cwd, cliFor(target, configPath));
  assert.equal(config.miscFolder, 'ExplicitMisc');
  assert.equal(config.omitMisc, true);
});

test('loadConfig: an upper layer wins only when it actually sets the value (R17)', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'fo-cwd-'));
  const target = await mkdtemp(join(tmpdir(), 'fo-target-'));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(join(cwd, '.file-organizer.json'), JSON.stringify({ miscFolder: 'CwdMisc' }), 'utf8');
  await writeFile(join(target, '.file-organizer.json'), JSON.stringify({ omitMisc: true }), 'utf8');

  const config = await loadConfigVia(target, cwd, cliFor(target));
  assert.equal(config.miscFolder, 'CwdMisc'); // target did NOT set it → cwd value stays
  assert.equal(config.omitMisc, true); // target set it
});

test('loadConfig keeps defaults when no config files exist (R17)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fo-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = await loadConfigVia(dir, dir, cliFor(dir));
  assert.equal(config.miscFolder, 'Others');
  assert.equal(config.omitMisc, false);
  assert.deepEqual(config.configFilesLoaded, []);
});

test('loadConfig deduplicates configFilesLoaded when cwd === target (R9)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fo-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, '.file-organizer.json'), JSON.stringify({ miscFolder: 'Otros' }), 'utf8');

  const config = await loadConfigVia(dir, dir, cliFor(dir));
  assert.equal(config.configFilesLoaded.length, 1);
  assert.equal(config.configFilesLoaded[0], join(dir, '.file-organizer.json'));
});

test('loadConfig records every loaded config file for the ignored list (R9)', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'fo-cwd-'));
  const target = await mkdtemp(join(tmpdir(), 'fo-target-'));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  const configPath = join(cwd, 'explicit.json');
  await writeFile(join(cwd, '.file-organizer.json'), '{}', 'utf8');
  await writeFile(join(target, '.file-organizer.json'), '{}', 'utf8');
  await writeFile(configPath, '{}', 'utf8');

  const config = await loadConfigVia(target, cwd, cliFor(target, configPath));
  assert.deepEqual(
    new Set(config.configFilesLoaded),
    new Set([join(cwd, '.file-organizer.json'), join(target, '.file-organizer.json'), configPath]),
  );
});