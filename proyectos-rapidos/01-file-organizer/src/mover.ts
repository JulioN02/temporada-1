/**
 * Safe file moving: read-only planning (scan + collision resolution) separated
 * from execution (mkdir, rename with EXDEV fallback, dry-run). The plan is
 * deterministic (lexicographic by source name); execution reports per-file
 * errors and continues (R14).
 *
 * `MoveDeps` is a TEST-ONLY seam for simulating EXDEV/partial copies; the
 * production path never injects it (real fs/promises + stream pipeline).
 */
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { classify } from './classify.ts';
import type { Config } from './config.ts';

export interface MoveOp {
  from: string; // absolute source path
  to: string; // absolute destination path
}

export type SkipReason =
  | { kind: 'hidden' }
  | { kind: 'directory' }
  | { kind: 'symlink' }
  | { kind: 'ignored' }
  | { kind: 'misc-omitted' };

export interface SkipEntry {
  path: string; // file name relative to the target root
  reason: SkipReason;
}

export interface PlanResult {
  ops: MoveOp[];
  skipped: SkipEntry[];
}

export interface ErrorEntry {
  path: string;
  message: string;
}

export interface MoveReport {
  moved: number;
  skipped: number;
  errors: number;
  movedOps: MoveOp[];
  skippedEntries: SkipEntry[];
  errorEntries: ErrorEntry[];
}

/** Test-only seam (see module header). */
export interface MoveDeps {
  rename: (from: string, to: string) => Promise<void>;
  copy: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTDIR: a path component is a regular file, so `path` cannot exist as
    // a file either — treating it as non-existent also keeps resolveUniquePath
    // from looping forever when a category name collides with a file.
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    return true; // conservative: cannot verify → assume exists (never overwrite)
  }
}

/**
 * Splits a file name into stem and extension (extension keeps its dot;
 * files without a dot get an empty extension).
 */
function splitExt(filename: string): { stem: string; ext: string } {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return { stem: filename, ext: '' };
  return { stem: filename.slice(0, idx), ext: filename.slice(idx) };
}

/**
 * Resolves a non-colliding destination name inside `destDir`, checking both
 * the filesystem and the intra-plan reservation set. Existing or reserved
 * names get a deterministic suffix: `name (1).ext`, `name (2).ext`, ...
 * Returns the bare file name (the caller joins it with `destDir`).
 */
export async function resolveUniquePath(destDir: string, filename: string, reserved: Set<string>): Promise<string> {
  const candidate = join(destDir, filename);
  if (!(await exists(candidate)) && !reserved.has(candidate)) {
    return filename;
  }

  const { stem, ext } = splitExt(filename);
  let i = 1;
  for (;;) {
    const name = `${stem} (${i})${ext}`;
    const full = join(destDir, name);
    if (!(await exists(full)) && !reserved.has(full)) {
      return name;
    }
    i += 1;
  }
}

/** Locale-independent lexicographic comparison (stable order for R20). */
function compareNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Read-only scan of the target root: filters dirs/symlinks/hidden/ignored,
 * sorts candidates lexicographically (stable report, R20), classifies each
 * one and resolves destinations with the intra-plan reservation set.
 */
export async function planMoves(
  targetDir: string,
  config: Config,
  options: { includeHidden: boolean },
): Promise<PlanResult> {
  const entries = await readdir(targetDir, { withFileTypes: true });

  const candidates: { name: string }[] = [];
  const skipped: SkipEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      skipped.push({
        path: entry.name,
        reason: entry.isSymbolicLink() ? { kind: 'symlink' } : { kind: 'directory' },
      });
      continue;
    }
    if (entry.name.startsWith('.') && !options.includeHidden) {
      skipped.push({ path: entry.name, reason: { kind: 'hidden' } });
      continue;
    }
    if (config.configFilesLoaded.includes(resolve(join(targetDir, entry.name)))) {
      skipped.push({ path: entry.name, reason: { kind: 'ignored' } });
      continue;
    }
    candidates.push({ name: entry.name });
  }

  candidates.sort((a, b) => compareNames(a.name, b.name));

  const ops: MoveOp[] = [];
  const reserved = new Set<string>();

  for (const entry of candidates) {
    const classification = classify(entry.name, config.mapping, config.omitMisc);
    if (classification.kind === 'skip') {
      skipped.push({ path: entry.name, reason: { kind: 'misc-omitted' } });
      continue;
    }
    const destDir =
      classification.kind === 'category'
        ? join(targetDir, classification.category)
        : join(targetDir, config.miscFolder);

    const name = await resolveUniquePath(destDir, entry.name, reserved);
    const dest = join(destDir, name);
    reserved.add(dest);
    ops.push({ from: resolve(join(targetDir, entry.name)), to: dest });
  }

  return { ops, skipped };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function defaultDeps(): MoveDeps {
  return {
    rename: rename,
    copy: async (from, to) => {
      await pipeline(createReadStream(from), createWriteStream(to));
    },
    unlink: unlink,
  };
}

/** Best-effort removal of a partial copy; ignores cleanup failures. */
async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // cleanup of a partial copy is best-effort (R13)
  }
}

async function moveWithFallback(src: string, dest: string, deps: MoveDeps): Promise<void> {
  try {
    await deps.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    try {
      await deps.copy(src, dest);
      await deps.unlink(src);
    } catch (copyErr) {
      await safeUnlink(dest);
      throw copyErr;
    }
  }
}

/**
 * Moves one file: `rename` primary, copy+delete fallback on EXDEV (R13).
 * The destination is always collision-free before this runs (axiom 3).
 */
export async function moveFile(src: string, dest: string, deps?: MoveDeps): Promise<void> {
  await moveWithFallback(src, dest, deps ?? defaultDeps());
}

/**
 * Executes the planned moves. Dry-run performs ZERO writes (not even mkdir)
 * and reports the plan as-is (R10). Real execution: recursive mkdir of each
 * destination folder (memoized per directory, R12), TOCTOU re-check of the
 * destination with fresh collision resolution, and per-file try/catch that
 * reports errors and continues (R14).
 */
export async function executeMoves(ops: MoveOp[], options: { dryRun: boolean }): Promise<MoveReport> {
  const report: MoveReport = {
    moved: 0,
    skipped: 0,
    errors: 0,
    movedOps: [],
    skippedEntries: [],
    errorEntries: [],
  };

  if (options.dryRun) {
    report.moved = ops.length;
    report.movedOps = ops;
    return report;
  }

  const mkdirDone = new Set<string>();

  for (const op of ops) {
    const destDir = dirname(op.to);

    if (!mkdirDone.has(destDir)) {
      try {
        await mkdir(destDir, { recursive: true });
        mkdirDone.add(destDir);
      } catch (err) {
        report.errors += 1;
        report.errorEntries.push({ path: op.from, message: errorMessage(err) });
        continue; // other destinations may still succeed (R12)
      }
    }

    // TOCTOU re-check: the destination may have appeared since planning.
    let dest = op.to;
    if (await exists(dest)) {
      dest = join(destDir, await resolveUniquePath(destDir, basename(dest), new Set<string>()));
    }

    try {
      await moveFile(op.from, dest);
      report.moved += 1;
      report.movedOps.push({ from: op.from, to: dest });
    } catch (err) {
      report.errors += 1;
      report.errorEntries.push({ path: op.from, message: errorMessage(err) });
    }
  }

  return report;
}