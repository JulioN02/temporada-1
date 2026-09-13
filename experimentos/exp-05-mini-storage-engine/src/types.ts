/**
 * Shared types and constants for the mini storage engine.
 * This module is pure: it contains no logic, only the on-disk format contract
 * (op codes, header magic) and the public API surface.
 */

/** Operation codes for WAL records (const-types pattern — never bare string unions). */
export const OP = { SET: 'SET', DELETE: 'DELETE' } as const;
export type Op = (typeof OP)[keyof typeof OP];

/** Magic header written once at the top of every non-empty log file. */
export const HEADER = { magic: 'JSMKV1', version: 1 } as const;
export type HeaderRecord = typeof HEADER;

/** A SET record: upserts `value` under `key`. */
export interface SetRecord {
  op: typeof OP.SET;
  key: string;
  value: string;
  seq: number;
}

/** A DELETE record: removes `key`. */
export interface DeleteRecord {
  op: typeof OP.DELETE;
  key: string;
  seq: number;
}

/** Discriminated union of all WAL records (narrowed by `op`). */
export type LogRecord = SetRecord | DeleteRecord;

/** Result of parsing a log buffer: records in file order + byte offset to truncate a torn tail. */
export interface ParseResult {
  records: LogRecord[];
  truncateTo: number | null;
}

/** Synchronous KV store API returned by `createStorage`. */
export interface StorageEngine {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): boolean;
  close(): void;
}