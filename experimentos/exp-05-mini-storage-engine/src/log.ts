/**
 * PURE physical format layer: bytes ↔ records + truncation-offset computation.
 *
 * This module MUST NOT import `node:fs` — it operates only on in-memory Buffers
 * and plain records, so crash scenarios can be handcrafted as raw log strings
 * in tests without any fs mocking.
 */

import { HEADER, OP } from './types.ts';
import type { DeleteRecord, HeaderRecord, LogRecord, ParseResult, SetRecord } from './types.ts';

/** The complete header line as it appears on disk (`\n`-terminated). */
export const HEADER_LINE: string = JSON.stringify(HEADER) + '\n';

/** Serialize a record to a complete on-disk line, including the trailing `\n`. */
export function encodeRecord(record: LogRecord): string {
  return JSON.stringify(record) + '\n';
}

interface Segment {
  line: Buffer;
  start: number;
  terminated: boolean;
}

function isHeader(value: unknown): value is HeaderRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  return (
    keys.length === 2 &&
    keys.includes('magic') &&
    keys.includes('version') &&
    v.magic === HEADER.magic &&
    v.version === HEADER.version
  );
}

function isSetRecord(value: unknown): value is SetRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const seq = v.seq;
  return (
    v.op === OP.SET &&
    typeof v.key === 'string' &&
    typeof v.value === 'string' &&
    typeof seq === 'number' &&
    Number.isInteger(seq) &&
    seq > 0
  );
}

function isDeleteRecord(value: unknown): value is DeleteRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const seq = v.seq;
  return (
    v.op === OP.DELETE &&
    typeof v.key === 'string' &&
    typeof seq === 'number' &&
    Number.isInteger(seq) &&
    seq > 0
  );
}

function corruptError(lineNumber: number, byteOffset: number): Error {
  return new Error(`corrupt record at line ${lineNumber} (byte offset ${byteOffset})`);
}

/**
 * Parse a log buffer into records (file order) plus the byte offset where a
 * torn tail must be truncated (`null` = no truncation needed).
 *
 * - 0-byte buffer → fresh store (`{ records: [], truncateTo: null }`).
 * - Non-empty buffer MUST start with a complete, exact header line; any header
 *   failure throws (a header is NEVER truncatable).
 * - A record that fails to decode (or is not `\n`-terminated) is a torn tail
 *   ONLY when it is the final segment; mid-file failures throw with the line
 *   number and byte offset, and the file is never truncated.
 */
export function parseLog(buf: Buffer): ParseResult {
  if (buf.byteLength === 0) {
    return { records: [], truncateTo: null };
  }

  // Byte-wise split on 0x0A — every offset is a native byte offset.
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 0; i < buf.byteLength; i++) {
    if (buf[i] === 0x0a) {
      segments.push({ line: buf.subarray(start, i), start, terminated: true });
      start = i + 1;
    }
  }
  segments.push({ line: buf.subarray(start), start, terminated: false });

  // The final segment after the last `\n` is the line terminator, not a record.
  const last = segments[segments.length - 1];
  if (last !== undefined && last.line.byteLength === 0 && !last.terminated) {
    segments.pop();
  }

  // Header: first segment must be complete and decode to exactly HEADER.
  const first = segments[0];
  if (first === undefined) {
    throw new Error('invalid header: empty log file');
  }
  if (!first.terminated) {
    throw new Error('invalid header: first line is truncated (no trailing newline)');
  }
  let headerValue: unknown;
  try {
    headerValue = JSON.parse(first.line.toString('utf8'));
  } catch {
    throw new Error('invalid header: line 1 is not valid JSON (byte offset 0)');
  }
  if (!isHeader(headerValue)) {
    throw new Error(
      `invalid header: expected ${JSON.stringify(HEADER)}, got ${first.line.toString('utf8')}`,
    );
  }

  // Records after the header.
  const records: LogRecord[] = [];
  for (let idx = 1; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg === undefined) continue; // noUncheckedIndexedAccess guard

    let decoded: unknown;
    try {
      decoded = JSON.parse(seg.line.toString('utf8'));
    } catch {
      if (idx === segments.length - 1) {
        return { records, truncateTo: seg.start }; // torn tail
      }
      throw corruptError(idx + 1, seg.start); // mid-file corruption
    }

    // A final segment WITHOUT `\n` is ALWAYS torn — even if its JSON parses —
    // because the next append would merge with it and corrupt later lines.
    if (!seg.terminated) {
      return { records, truncateTo: seg.start };
    }

    if (isSetRecord(decoded) || isDeleteRecord(decoded)) {
      records.push(decoded);
    } else if (idx === segments.length - 1) {
      return { records, truncateTo: seg.start }; // valid JSON, invalid record, last line → torn
    } else {
      throw corruptError(idx + 1, seg.start); // valid JSON, invalid record, mid-file
    }
  }

  return { records, truncateTo: null };
}