/**
 * PURE logical state rebuild: records (in file order) → in-memory Map + seq.
 *
 * This module MUST NOT import `node:fs` — it only transforms plain records,
 * so recovery semantics can be unit-tested without any I/O.
 */

import { OP } from './types.ts';
import type { LogRecord } from './types.ts';

export interface ReplayResult {
  index: Map<string, string>;
  lastSeq: number;
}

/**
 * Replay records in file order: SET upserts, DELETE removes, last-write-wins.
 * `lastSeq` is the max seq seen (0 when there are no records) — the caller
 * restores the sequence counter so new records continue at max + 1.
 */
export function replay(records: LogRecord[]): ReplayResult {
  const index = new Map<string, string>();
  let lastSeq = 0;

  for (const record of records) {
    if (record.seq > lastSeq) {
      lastSeq = record.seq;
    }
    if (record.op === OP.SET) {
      index.set(record.key, record.value);
    } else {
      index.delete(record.key);
    }
  }

  return { index, lastSeq };
}