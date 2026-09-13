/**
 * Shared test fixtures (exp-02 convention): a real store on a temp-dir file per
 * test, plus raw-log crafting/reading helpers for crash & durability scenarios.
 * This file is NOT a test file itself (no .test.ts suffix) — it exports
 * fixture functions used by test files.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import { createStorage } from '../src/storage.ts';
import type { StorageEngine } from '../src/types.ts';

export interface StoreFixture {
  store: StorageEngine;
  dir: string;
  path: string;
}

/** Fresh store on a temp-dir file; cleans up the dir when the test ends. */
export function makeStore(t: TestContext): StoreFixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'exp05-'));
  const filePath = path.join(dir, 'store.log');
  const store = createStorage(filePath);
  t.after(() => {
    try {
      store.close();
    } catch {
      // store already closed by the test — double close throws by contract (R1-S4)
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir, path: filePath };
}

/** Bare temp dir (no store opened) for tests that handcraft the log first. */
export function makeDir(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'exp05-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Handcraft a raw log file directly (header + records + torn tails). */
export function writeRawLog(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf8');
}

/** Read the raw log file as a Buffer — for byte-level assertions. */
export function readRawLog(filePath: string): Buffer {
  return readFileSync(filePath);
}