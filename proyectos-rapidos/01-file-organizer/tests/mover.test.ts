import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { planMoves } from '../src/mover.ts';
import { DEFAULT_MAPPING } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import type { MoveDeps, MoveOp } from '../src/mover.ts';

// executeMoves and moveFile are resolved via dynamic import until T4.6
// implements them, so plan-level tests stay meaningful while the execution
// path is still RED.
async function executeMovesVia(ops: MoveOp[], options: { dryRun: boolean }) {
  const { executeMoves } = await import('../src/mover.ts');
  return executeMoves(ops, options);
}

async function moveFileVia(src: string, dest: string, deps?: MoveDeps) {
  const { moveFile } = await import('../src/mover.ts');
  return moveFile(src, dest, deps);
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    mapping: { ...DEFAULT_MAPPING },
    miscFolder: 'Others',
    omitMisc: false,
    configFilesLoaded: [],
    ...overrides,
  };
}

async function makeFixture(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fo-mover-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Recursive, deterministic snapshot of a directory tree (path → type). */
async function treeSnapshot(root: string): Promise<string> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relPath = rel === '' ? entry.name : join(rel, entry.name);
      if (entry.isDirectory()) {
        out.push(`dir:${relPath}`);
        await walk(join(dir, entry.name), relPath);
      } else if (entry.isSymbolicLink()) {
        out.push(`link:${relPath}`);
      } else {
        out.push(`file:${relPath}`);
      }
    }
  }
  await walk(root, '');
  return out.join('\n');
}

test('planMoves maps known extensions to category folders (R2)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'report.pdf'), 'pdf');
  await writeFile(join(dir, 'photo.png'), 'png');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });

  assert.deepEqual(plan.ops, [
    { from: join(dir, 'photo.png'), to: join(dir, 'Images', 'photo.png') },
    { from: join(dir, 'report.pdf'), to: join(dir, 'PDF', 'report.pdf') },
  ]);
  assert.equal(plan.skipped.length, 0);
});

test('planMoves skips directories, symlinks and hidden files (R8)', async (t) => {
  const dir = await makeFixture(t);
  await mkdir(join(dir, 'subdir'));
  await writeFile(join(dir, 'subdir', 'inner.txt'), 'x');
  await writeFile(join(dir, 'report.pdf'), 'pdf');
  await symlink(join(dir, 'report.pdf'), join(dir, 'link.pdf'));
  await writeFile(join(dir, '.hidden'), 'x');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });

  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].from, join(dir, 'report.pdf'));
  const reasons = plan.skipped.map((s) => s.reason.kind).sort();
  assert.deepEqual(reasons, ['directory', 'hidden', 'symlink']);
});

test('planMoves never plans a loaded config file, even when json maps to Code (R9)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, '.file-organizer.json'), '{}');
  await writeFile(join(dir, 'a.json'), '{}');

  const config = makeConfig({ configFilesLoaded: [join(dir, '.file-organizer.json')] });
  const plan = await planMoves(dir, config, { includeHidden: true });

  const planned = plan.ops.map((op) => op.from);
  assert.ok(!planned.includes(join(dir, '.file-organizer.json')));
  assert.ok(planned.includes(join(dir, 'a.json')));
  assert.ok(plan.skipped.some((s) => s.reason.kind === 'ignored' && s.path === '.file-organizer.json'));
});

// ---------------------------------------------------------------------------
// Phase 4.2 — collisions (R11), misc (R4/R5) and dry-run (R10)
// ---------------------------------------------------------------------------

test('planMoves resolves a collision with a deterministic suffix (R11)', async (t) => {
  const dir = await makeFixture(t);
  await mkdir(join(dir, 'PDF'));
  await writeFile(join(dir, 'PDF', 'report.pdf'), 'existing');
  await writeFile(join(dir, 'report.pdf'), 'new');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  assert.deepEqual(plan.ops, [{ from: join(dir, 'report.pdf'), to: join(dir, 'PDF', 'report (1).pdf') }]);
});

test('planMoves increments the suffix while the destination is taken (R11)', async (t) => {
  const dir = await makeFixture(t);
  await mkdir(join(dir, 'PDF'));
  await writeFile(join(dir, 'PDF', 'report.pdf'), 'existing');
  await writeFile(join(dir, 'PDF', 'report (1).pdf'), 'existing too');
  await writeFile(join(dir, 'report.pdf'), 'new');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  assert.deepEqual(plan.ops, [{ from: join(dir, 'report.pdf'), to: join(dir, 'PDF', 'report (2).pdf') }]);
});

test('planMoves reserves intra-plan destinations so planned moves never collide (R11)', async (t) => {
  const dir = await makeFixture(t);
  await mkdir(join(dir, 'PDF'));
  await writeFile(join(dir, 'PDF', 'a.pdf'), 'pre-existing');
  await writeFile(join(dir, 'a.pdf'), 'first');
  await writeFile(join(dir, 'a (1).pdf'), 'second');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  assert.equal(plan.ops.length, 2);
  // Code-unit sort: "a (1).pdf" (space 0x20) < "a.pdf" (dot 0x2E)
  assert.deepEqual(plan.ops[0], { from: join(dir, 'a (1).pdf'), to: join(dir, 'PDF', 'a (1).pdf') });
  // a.pdf must NOT reuse the destination already reserved by the first move
  assert.deepEqual(plan.ops[1], { from: join(dir, 'a.pdf'), to: join(dir, 'PDF', 'a (2).pdf') });
  assert.equal(new Set(plan.ops.map((op) => op.to)).size, 2); // every destination is unique
});

test('planMoves sends unknown extensions to the misc folder (R4)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'data.bin'), 'x');
  await writeFile(join(dir, 'LICENSE'), 'x');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  assert.deepEqual(plan.ops, [
    { from: join(dir, 'LICENSE'), to: join(dir, 'Others', 'LICENSE') },
    { from: join(dir, 'data.bin'), to: join(dir, 'Others', 'data.bin') },
  ]);
});

test('planMoves uses a custom miscFolder when configured (R4)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'data.bin'), 'x');

  const plan = await planMoves(dir, makeConfig({ miscFolder: 'Otros' }), { includeHidden: false });
  assert.deepEqual(plan.ops, [{ from: join(dir, 'data.bin'), to: join(dir, 'Otros', 'data.bin') }]);
});

test('planMoves marks misc files as skipped when omitMisc is set (R5)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'data.bin'), 'x');
  await writeFile(join(dir, 'report.pdf'), 'x');

  const plan = await planMoves(dir, makeConfig({ omitMisc: true }), { includeHidden: false });
  assert.deepEqual(plan.ops, [{ from: join(dir, 'report.pdf'), to: join(dir, 'PDF', 'report.pdf') }]);
  assert.deepEqual(plan.skipped, [{ path: 'data.bin', reason: { kind: 'misc-omitted' } }]);
});

test('executeMoves in dry-run performs zero writes: tree snapshot is identical (R10)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'report.pdf'), 'pdf');
  await writeFile(join(dir, 'data.bin'), 'bin');
  await mkdir(join(dir, 'subdir'));

  const before = await treeSnapshot(dir);
  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  const report = await executeMovesVia(plan.ops, { dryRun: true });
  const after = await treeSnapshot(dir);

  assert.equal(before, after); // not even mkdir happened
  assert.equal(report.moved, plan.ops.length);
  assert.equal(report.errors, 0);
  assert.ok(report.movedOps.length > 0);
  await assert.rejects(stat(join(dir, 'PDF')));
});

// ---------------------------------------------------------------------------
// Phase 4.3 — real execution (R12–R15, R22) and EXDEV fallback (R13)
// ---------------------------------------------------------------------------

test('executeMoves creates category folders recursively and moves files (R12)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'report.pdf'), 'pdf');
  await writeFile(join(dir, 'data.bin'), 'bin');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  const report = await executeMovesVia(plan.ops, { dryRun: false });

  assert.equal(report.moved, 2);
  assert.equal(report.errors, 0);
  assert.equal(await readFile(join(dir, 'PDF', 'report.pdf'), 'utf8'), 'pdf');
  assert.equal(await readFile(join(dir, 'Others', 'data.bin'), 'utf8'), 'bin');
  await assert.rejects(stat(join(dir, 'report.pdf')));
});

test('executeMoves reports a per-file error when a category folder is a file, and continues (R12)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'PDF'), 'i am a file, not a folder');
  await writeFile(join(dir, 'report.pdf'), 'pdf');
  await writeFile(join(dir, 'photo.png'), 'png');

  // The file named "PDF" is ignored (R9), so it stays and blocks mkdir("PDF").
  const config = makeConfig({ configFilesLoaded: [join(dir, 'PDF')] });
  const plan = await planMoves(dir, config, { includeHidden: false });
  const report = await executeMovesVia(plan.ops, { dryRun: false });

  // ops order: photo.png → Images (moved), report.pdf → PDF (mkdir error)
  assert.equal(report.moved, 1);
  assert.equal(report.errors, 1);
  assert.equal(report.errorEntries[0].path, join(dir, 'report.pdf'));
  assert.ok((await stat(join(dir, 'Images', 'photo.png'))).isFile());
  // the blocking file and the failed op's source are both untouched
  assert.equal(await readFile(join(dir, 'PDF'), 'utf8'), 'i am a file, not a folder');
  assert.equal(await readFile(join(dir, 'report.pdf'), 'utf8'), 'pdf');
});

test('executeMoves is idempotent: a second run moves zero files (R15)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'report.pdf'), 'pdf');
  await writeFile(join(dir, 'photo.png'), 'png');

  const first = await executeMovesVia((await planMoves(dir, makeConfig(), { includeHidden: false })).ops, { dryRun: false });
  assert.equal(first.moved, 2);

  const secondPlan = await planMoves(dir, makeConfig(), { includeHidden: false });
  assert.equal(secondPlan.ops.length, 0); // only category dirs remain at the top level
  const second = await executeMovesVia(secondPlan.ops, { dryRun: false });
  assert.equal(second.moved, 0);
  assert.equal(second.errors, 0);
});

test('executeMoves on an empty directory is a no-op (R22)', async (t) => {
  const dir = await makeFixture(t);

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  const report = await executeMovesVia(plan.ops, { dryRun: false });

  assert.equal(plan.ops.length, 0);
  assert.equal(report.moved, 0);
  assert.equal(report.skipped, 0);
  assert.equal(report.errors, 0);
  const entries = await readdir(dir);
  assert.deepEqual(entries, []);
});

test('executeMoves reports ENOENT per-file and continues (TOCTOU, R14)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, 'a.pdf'), 'a');
  await writeFile(join(dir, 'b.png'), 'b');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: false });
  assert.equal(plan.ops.length, 2);
  await rm(join(dir, 'a.pdf')); // file disappears between plan and execute

  const report = await executeMovesVia(plan.ops, { dryRun: false });
  assert.equal(report.moved, 1);
  assert.equal(report.errors, 1);
  assert.equal(report.errorEntries[0].path, join(dir, 'a.pdf'));
  assert.ok((await stat(join(dir, 'Images', 'b.png'))).isFile());
});

test('planMoves with includeHidden processes dotfiles into the misc folder (R7)', async (t) => {
  const dir = await makeFixture(t);
  await writeFile(join(dir, '.env'), 'secret');

  const plan = await planMoves(dir, makeConfig(), { includeHidden: true });
  assert.deepEqual(plan.ops, [{ from: join(dir, '.env'), to: join(dir, 'Others', '.env') }]);
});

function exdevError(): NodeJS.ErrnoException {
  const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
  err.code = 'EXDEV';
  return err;
}

test('moveFile falls back to copy+unlink when rename fails with EXDEV (R13)', async (t) => {
  const dir = await makeFixture(t);
  const src = join(dir, 'a.txt');
  const dest = join(dir, 'sub', 'a.txt');
  await mkdir(join(dir, 'sub'));
  await writeFile(src, 'hello');

  const deps: MoveDeps = {
    rename: async () => {
      throw exdevError();
    },
    copy: async (from, to) => {
      await pipeline(createReadStream(from), createWriteStream(to));
    },
    unlink: async (p) => {
      await unlink(p);
    },
  };

  await moveFileVia(src, dest, deps);
  assert.equal(await readFile(dest, 'utf8'), 'hello');
  await assert.rejects(stat(src)); // source removed only after a successful copy
});

test('moveFile cleans up a partial copy and keeps the source when copy fails (R13)', async (t) => {
  const dir = await makeFixture(t);
  const src = join(dir, 'a.txt');
  const dest = join(dir, 'sub', 'a.txt');
  await mkdir(join(dir, 'sub'));
  await writeFile(src, 'hello');

  const deps: MoveDeps = {
    rename: async () => {
      throw exdevError();
    },
    copy: async (from, to) => {
      await writeFile(to, 'partial');
      throw new Error('disk full');
    },
    unlink: async (p) => {
      await unlink(p);
    },
  };

  await assert.rejects(moveFileVia(src, dest, deps), /disk full/);
  assert.equal(await readFile(src, 'utf8'), 'hello'); // source intact
  await assert.rejects(stat(dest)); // partial copy removed (best-effort cleanup)
});