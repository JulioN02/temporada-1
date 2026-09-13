/**
 * I/O + orchestration layer: the `createStorage` factory.
 *
 * Owns the single file descriptor, the in-memory Map index, the monotonic seq
 * counter and the closed flag. Recovery (parse → truncate torn tail → replay)
 * runs once at open, BEFORE any read/write is served.
 */

import {
  appendFileSync,
  closeSync,
  ftruncateSync,
  fsyncSync,
  openSync,
  readFileSync,
} from 'node:fs';

import { HEADER_LINE, encodeRecord, parseLog } from './log.ts';
import { replay } from './recovery.ts';
import { OP } from './types.ts';
import type { DeleteRecord, SetRecord, StorageEngine } from './types.ts';

/**
 * Open-or-create the log file, validate the header, truncate any torn tail,
 * replay all records into the in-memory index and restore the seq counter.
 * Throws loudly on invalid header or mid-file corruption (fd is closed first —
 * no dangling descriptor, no usable store).
 */
export function createStorage(filePath: string): StorageEngine {
  const fd = openSync(filePath, 'a+');
  let closed = false;
  let headerWritten = false;
  let index = new Map<string, string>();
  let seq = 0;

  try {
    const buf = readFileSync(fd); // reads the whole file from the start
    headerWritten = buf.byteLength > 0; // a non-empty file already carries the header (validated below)
    const { records, truncateTo } = parseLog(buf);
    if (truncateTo !== null) {
      // Torn tail: truncate BEFORE serving any read/write (R6-S2), then fsync
      // so the file is parseable at every step (I5). ftruncateSync is the
      // fd-based variant (truncateSync only takes paths).
      ftruncateSync(fd, truncateTo);
      fsyncSync(fd);
    }
    const rebuilt = replay(records);
    index = rebuilt.index;
    seq = rebuilt.lastSeq;
  } catch (err) {
    closeSync(fd);
    throw err;
  }

  const nextSeq = (): number => ++seq;

  const assertOpen = (): void => {
    if (closed) throw new Error('storage engine is closed');
  };

  // Assertion signatures require function declarations with explicit annotations.
  function validateKey(value: unknown): asserts value is string {
    if (typeof value !== 'string') throw new TypeError('key must be a string');
  }

  function validateValue(value: unknown): asserts value is string {
    if (typeof value !== 'string') throw new TypeError('value must be a string');
  }

  /** Append a line at EOF and fsync — durable BEFORE this call returns (R2-S3). */
  const appendAndSync = (line: string): void => {
    if (!headerWritten) {
      // Fresh store: the first record is preceded by the header line (R1-S2).
      appendFileSync(fd, HEADER_LINE);
      headerWritten = true;
    }
    appendFileSync(fd, line);
    fsyncSync(fd);
  };

  return {
    get(key: string): string | undefined {
      assertOpen();
      validateKey(key);
      return index.get(key); // missing → undefined, never throws (R3-S2)
    },

    set(key: string, value: string): void {
      assertOpen();
      validateKey(key);
      validateValue(value);
      const record: SetRecord = { op: OP.SET, key, value, seq: nextSeq() };
      appendAndSync(encodeRecord(record));
      index.set(key, value);
    },

    delete(key: string): boolean {
      assertOpen();
      validateKey(key);
      if (!index.has(key)) return false; // no record appended (no log pollution, R4-S2)
      const record: DeleteRecord = { op: OP.DELETE, key, seq: nextSeq() };
      appendAndSync(encodeRecord(record));
      index.delete(key);
      return true;
    },

    close(): void {
      assertOpen(); // double close throws (R1-S4)
      fsyncSync(fd);
      closeSync(fd);
      closed = true;
    },
  };
}